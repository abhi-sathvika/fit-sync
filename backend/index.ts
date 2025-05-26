import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import scoreRouter from './scoreRoute'; // ✅ Router, not a function

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use(cors({
  origin: ['https://fit-sync-gilt.vercel.app/', 'http://localhost:8080'],// or whatever your React port is
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '10mb' }));


app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ✅ Now this works, because `scoreRouter` is a Router, not a function
app.use('/api/score', scoreRouter);

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});




