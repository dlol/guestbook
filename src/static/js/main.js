function clearInputs() {
    document.getElementById('guest-name').value = ''
    document.getElementById('guest-website').value = ''
    document.getElementById('guest-comment').value = ''
}

function quote(number) {
    let textarea = document.getElementById('guest-comment')
    textarea.value += `>>${number}\n`
}

function toggleReverse() {
    var url = window.location.href
    var params = new URLSearchParams(window.location.search)

    if (params.has('reverse')) {
        var currentValue = params.get('reverse')
        if (currentValue === 'true') {
            params.delete('reverse')
        }
    } else {
        params.set('reverse', 'true')
    }

    var newUrl = `${url.split('?')[0]}?${params.toString()}`
    window.location.href = newUrl
}

// Autism. Or perfectionism idk
window.onload = () => {
    var url = window.location.href

    if (url.endsWith('/?')) {
        let modifiedUrl = url.replace('/?', '/');
        window.location.href = modifiedUrl
    }
}
