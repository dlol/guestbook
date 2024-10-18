const express = require('express')
const sqlite3 = require('sqlite3')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const sanitizeHtml = require('sanitize-html')
const ping = require('ping')
const axios = require('axios')
const { DateTime } = require('luxon')

const config = yaml.load(fs.readFileSync(process.argv.includes('--docker') ? 'config/config.yml' : 'config.yml', 'utf8'))
console.log('Your config.yml file:')
console.log(config)
const maxCommentLen = config.maxCommentLen
const siteTitle = config.siteTitle
const hoursPerPost = config.hoursPerPost
const postsPerPage = config.postsPerPage
const maxNameLen = config.maxNameLen
const maxSiteLen = config.maxSiteLen
const whitelistedIPs = config.whitelistedIPs
const faviconApi = config.faviconApi
const permalink = config.permalink
const port = config.port
const root = config.root
const showStatus = config.showStatus
const cloudflare = config.cloudflare

const regexUrl  = /^(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/)?(?:(?:[a-zA-Z\u00a1-\uffff0-9]+-?)*[a-zA-Z\u00a1-\uffff0-9]+)(?:\.(?:[a-zA-Z\u00a1-\uffff0-9]+-?)*[a-zA-Z\u00a1-\uffff0-9]+)*(?:\.(?:[a-zA-Z\u00a1-\uffff]{2,}))(?:\/[^\s]*)?$/
const regexName = /^(?!.*[_ ]{2})(?![_ ])[\w ]+?(?<![_ ])$/

const app = express()
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, `views`))
app.set('trust proxy', true) // Fix req.ip behind reverse proxy

const db_file = process.argv.includes('--docker') ? 'db/guestbook.db' : 'guestbook.db'
const db = new sqlite3.Database(db_file)

const create_db_query = `CREATE TABLE guestbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    comment TEXT CHECK(length(comment) <= ${maxCommentLen}),
    name TEXT CHECK(length(name) <= ${maxNameLen}),
    website TEXT CHECK(length(website) <= ${maxSiteLen}),
    country TEXT CHECK(length(country) <= 2),
    date DATETIME
);`

if (!fs.existsSync(db_file)) {
    db.run(create_db_query, (err) => {
        if (err) {
            console.error(err)
        } else {
            console.log(
                `Database \"${db_file}\" not found. Database and table created successfully.`
            )
        }
    })
} else {
    console.log(`The database \"${db_file}\" already exists!`)
    db.get('SELECT COUNT(*) AS count FROM guestbook', (err, count) => {
        if (err) {
            console.error(err)
        } else {
            console.log('Number of posts found in the database:', count.count)
        }
    })
}

app.use(express.urlencoded({ extended: true }))
app.use(express.static(__dirname + 'static'))
app.use(root, express.static(path.join(__dirname, 'static')))

app.get(`${root}`, (req, res) => {
    db.all('SELECT * FROM guestbook', (err, rows) => {
        if (err) {
            console.error(err)
            res.status(500).render("reply", {
                title: 'HTTP Error 500',
                desc: 'Internal Server Error'
            })
        } else {
            let numOfRows = rows.length
            let numOfPages = Math.ceil(numOfRows / postsPerPage)
            let pageNumber = req.query.page ? Number(req.query.page) : 1

            if (pageNumber > numOfPages) {
                pageNumber = numOfRows
            } else if (pageNumber < 1 || isNaN(pageNumber)) {
                pageNumber = 1
            }

            // Reverse queries like 4chan
            let way = Boolean(req.query.reverse) === false ? 'DESC' : 'ASC'

            // Status
            websiteList = [...new Set(rows.map(guest => guest.website))]
            .reduce((filtered, website) => {
                if (website !== null) {
                    website = website.endsWith("/") ? website.slice(0, -1) : website
                    if (!filtered.includes(website)) {
                        filtered.push(website)
                    }
                }
                return filtered
            }, [])
            
            nameList    = [...new Set(rows.map(guest => guest.name))].filter(name => name !== null)
            nbUniqIp    = new Set(rows.map(guest => guest.ip)).size
            countries   = rows.map(guest => guest.country)
            totalPosts  = rows.length

            // Determine the SQL LIMIT starting number
            let startingLimit = (pageNumber - 1) * postsPerPage

            // Get the relevant number of POSTS for this starting page
            db.all(`SELECT * FROM guestbook ORDER BY id ${way} LIMIT ${startingLimit},${postsPerPage}`, (err, rows) => {
                if (err) {
                    console.error(err)
                    res.status(500).render("reply", {
                        title: 'HTTP Error 500',
                        desc: 'Internal Server Error'
                    })
                } else {
                    let iterator = (pageNumber - 5) < 1 ? 1 : pageNumber - 5;
                    let endingLink = (iterator + 9) <= numOfPages ? (iterator + 9) : pageNumber + (numOfPages - pageNumber);
                    if (endingLink < (pageNumber + 4)) {
                        iterator -= (pageNumber + 4) - numOfPages;
                    }
                    res.render('index', {
                        guestbook: rows,
                        pageNumber,
                        endingLink,
                        iterator,
                        way,
                        numOfPages,
                        title: siteTitle,
                        maxNameLen,
                        maxCommentLen,
                        maxSiteLen,
                        websiteList,
                        nameList,
                        countries,
                        nbUniqIp,
                        totalPosts,
                        faviconApi,
                        regexName,
                        regexUrl,
                        root,
                        showStatus
                    })
                }
            })
        }
    })
})

app.post(`${root}submit`, async (req, res) => {
    let ip = cloudflare ? req.header('CF-Connecting-IP') : req.ip
    let comment = req.body.comment; comment = sanitizeHtml(comment, { disallowedTagsMode: 'escape', allowedTags: [] })
    let website = req.body.website; if (website.trim() === '') { website = null }; if (website !== null) { website = website.replace(/^https?:\/\//, '').replace(/\/$/, '') }
    let name = req.body.name; if (name.trim() === '' || name.toLowerCase() === 'anonymous') { name = null }
    let date = new Date().toISOString()
    let host = website !== null ? (req.body.website).match(/^(?:https?:\/\/)?(?:[^@\n]+@)?([^:\/\n]+)/im)[1] : null
    
    try {
        const [dateRow, isAlive, geoIp] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get('SELECT date FROM guestbook WHERE ip LIKE ? ORDER BY id LIMIT 1', [ip], (err, dateRow) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve(dateRow)
                    }
                })
            }),
            // Only tests if host !== null
            host !== null
            ? new Promise((resolve) => {
                ping.sys.probe(host, function (isAlive) {
                    resolve(isAlive)
                })
            })
            : Promise.resolve(null),
            axios.get(`http://ip-api.com/json/${ip}`) // free api to get country codes based on ip
                .then(response => response.data)
                .catch(error => {
                    console.error(error)
                    return null
            })
        ])

        let country

        if (geoIp.status === 'success') {
            country = geoIp.countryCode.toLowerCase()
        } else {
            country = null
        }

        if (dateRow !== undefined && !whitelistedIPs.includes(ip)) {
            postHoursDiff = Math.abs(new Date(date) - new Date(dateRow.date)) / (1000 * 60 * 60)
        } else {
            postHoursDiff = hoursPerPost
        }

        if (name !== null && !regexName.test(name)) {
            res.render('reply', {
                response: 'Invalid name.',
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (website !== null && !regexUrl.test(website)) {
            res.render('reply', {
                response: 'Invalid website url.',
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (website !== null && !isAlive) {
            res.render('reply', {
                response: 'The website you entered seems to be down thus your comment won\'t be added. Try again.',
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (comment.length > maxCommentLen) {
            res.render('reply', {
                response: `Your comment must not be longer than ${maxCommentLen} characters.`,
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (comment.trim() === '') {
            res.render('reply', {
                response: 'You must provide a comment.',
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (name !== null && name.length > maxNameLen) {
            res.render('reply', {
                response: `Your name must not be longer than ${maxNameLen} characters.`,
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (website !== null && website.length > maxSiteLen) { 
            res.render('reply', {
                response: `Your website must not be longer than ${maxSiteLen} characters.`,
                title: siteTitle,
                http_error: false,
                root
            })
        } else if (postHoursDiff < hoursPerPost) {
            res.render('reply', {
                response: `You can only post once per ${hoursPerPost} hour(s).`,
                title: siteTitle,
                http_error: false,
                root
            })
        } else {
            db.run('INSERT INTO guestbook (name, ip, website, comment, country, date) VALUES (?, ?, ?, ?, ?, ?)', [name, ip, website, comment, country, date], (err) => {
                if (err) {
                    console.error(err)
                    res.status(500).render("reply", {
                        title: "HTTP Error 500",
                        desc: "Internal Server Error",
                        http_error: true,
                        root
                    })
                } else {
                    res.render('reply', {
                        response: 'Your query was registered correctly.',
                        title: siteTitle,
                        http_error: false,
                        root
                    })
                }
            })
        }
    } catch (err) {
        console.error(err)
        res.status(500).render('reply', {
            title: 'HTTP Error 500',
            desc: 'Internal Server Error',
            http_error: true,
            root
        })
    }
})

app.get(`${root}rss`, (req, res) => {
    db.all('SELECT * FROM guestbook', (err, rows) => {
        if (err) {
            console.error(err)
            res.status(500).render("reply", {
                title: 'HTTP Error 500',
                desc: 'Internal Server Error',
                root
            })
        } else {
            // Valid RSS requires dates in the RFC-822 standard, yeah I'm that autistic
            rows = rows.map(obj => {
                let dateTime = DateTime.fromISO(obj.date);
                let rfc822Date = dateTime.toRFC2822();
                return { ...obj, date: rfc822Date };
            })

            res.set('Content-Type', 'application/rss+xml')
            res.render('rss', {
                title: siteTitle,
                permalink,
                faviconApi,
                guestbook: rows,
                root
            })
        }
    })
})

app.use((req, res, next) => {
    res.status(404).render('reply', {
        title: 'HTTP Error 404',
        desc: 'You have probably lost yourself... This page does not exist.',
        http_error: true,
        root
    })
})

app.listen(port, () => {
    console.log(`Web Server is available at http://localhost:${port}${root}.`)
})
