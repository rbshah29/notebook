const header = document.createElement('div');
    header.id = 'header';
    header.innerHTML = '<h4>Notes</h4>';
    header.classList.add('header-container');

    document.body.insertBefore(header, document.body.firstChild);