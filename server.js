const express = require('express');
const mongoose = require('mongoose');
const path = require('path'); 
const app = express();
const port = 3000;

mongoose.connect('mongodb+srv://admin:admin@cluster0.hvvitwf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const Note = mongoose.model('Note', {
  text: String,
  left: Number,
  top: Number,
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/notes', async (req, res) => {
  const notes = await Note.find();
  res.json(notes);
});

app.post('/notes', async (req, res) => {
  const { text, left, top } = req.body;
  const note = new Note({ text, left, top });
  await note.save();
  res.json(note);
});

app.put('/notes/:id', async (req, res) => {
  const { text, left, top } = req.body;
  const note = await Note.findByIdAndUpdate(req.params.id, { text, left, top }, { new: true });
  res.json(note);
});

app.delete('/notes/:id', async (req, res) => {
  await Note.findByIdAndDelete(req.params.id);
  res.json({ message: 'Note deleted successfully' });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
