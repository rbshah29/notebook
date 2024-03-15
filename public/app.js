const appContainer = document.getElementById('app');

async function fetchNotes() {
  const response = await fetch('/notes');
  const notes = await response.json();
  return notes;
}

async function createNote() {
  const response = await fetch('/notes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: '', left: 100, top: 100 }),
  });
  const newNote = await response.json();
  return newNote;
}

async function updateNoteText(id, text, left, top) {
  await fetch(`/notes/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, left, top }),
  });
}

async function deleteNote(id) {
  await fetch(`/notes/${id}`, { method: 'DELETE' });
  window.location.reload();
}

function createNoteElement(note) {
  const noteElement = document.createElement('div');
  noteElement.classList.add('note');
  noteElement.innerText = note.text;

  noteElement.style.left = `${note.left}px`;
  noteElement.style.top = `${note.top}px`;

  const deleteButton = document.createElement('button');
  deleteButton.innerHTML = '<i class="fa fa-trash"></i>';
  deleteButton.classList.add('btn');
  deleteButton.classList.add('btn-danger');
  deleteButton.classList.add('delete-btn');
  deleteButton.addEventListener('click', async () => {
    await deleteNote(note._id);
    noteElement.remove();
  });

  const editButton = document.createElement('button');
  editButton.innerHTML = '<i class="fas fa-edit"></i>';
  editButton.classList.add('btn');
  editButton.classList.add('btn-info');
  editButton.classList.add('edit-btn');
  editButton.addEventListener('click', () => {
    const input = document.createElement('textarea');
    input.classList.add('form-control');
    input.classList.add('textbox-area');
    input.value = note.text;
    
    if (note.text) {
      input.style.width = `${noteElement.offsetWidth}px`;
      input.style.height = `${noteElement.offsetHeight}px`;
    }
  
    const saveButton = document.createElement('button');
    saveButton.innerHTML = '<i class="fa fa-book"></i>';
    saveButton.classList.add('btn');
    saveButton.classList.add('btn-success');
    saveButton.classList.add('save-btn');
    saveButton.addEventListener('click', async () => {
      const newText = input.value;
      await updateNoteText(note._id, newText, note.left, note.top);
      note.text = newText;
      noteElement.innerText = newText;
      noteElement.appendChild(editButton);
      noteElement.appendChild(deleteButton);
      noteElement.removeChild(input);
      noteElement.removeChild(saveButton);
    });
  
    noteElement.innerHTML = '';
    noteElement.appendChild(input);
    noteElement.appendChild(saveButton);
    noteElement.removeChild(editButton);
    noteElement.removeChild(deleteButton);
  });

  noteElement.appendChild(editButton);
  noteElement.appendChild(deleteButton);

  noteElement.addEventListener('mousedown', (e) => {
    let isDragging = true;
    let offsetX = e.clientX - noteElement.getBoundingClientRect().left;
    let offsetY = e.clientY - noteElement.getBoundingClientRect().top;
    noteElement.style.cursor = 'grabbing';

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', () => {
      isDragging = false;
      noteElement.style.cursor = 'grab';
      document.removeEventListener('mousemove', handleDrag);
      updateNotePosition(note._id, parseFloat(noteElement.style.left), parseFloat(noteElement.style.top));
    });

    function handleDrag(e) {
      if (isDragging) {
        const newLeft = e.clientX - offsetX;
        const newTop = e.clientY - offsetY;
        noteElement.style.left = `${newLeft}px`;
        noteElement.style.top = `${newTop}px`;
      }
    }
  });

  return noteElement;
}


async function init() {
  const notes = await fetchNotes();
  notes.forEach((note) => {
    const noteElement = createNoteElement(note);
    appContainer.appendChild(noteElement);
  });

  const addNoteButton = document.createElement('button');
  addNoteButton.innerHTML = '<i class="fa fa-plus"></i>';
  addNoteButton.classList.add('btn');
  addNoteButton.classList.add('add-btn');
  addNoteButton.addEventListener('click', async () => {
    const newNote = await createNote();
    const newNoteElement = createNoteElement(newNote);
    appContainer.appendChild(newNoteElement);
  });

  appContainer.appendChild(addNoteButton);
}

async function updateNotePosition(id, left, top) {
  await fetch(`/notes/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ left, top }),
  });
}

init();
