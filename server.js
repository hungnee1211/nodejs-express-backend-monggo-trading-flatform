import dotenv from "dotenv";
dotenv.config();

import express from "express";
import connectDB from "./db/db.js";
import cookieParser from "cookie-parser";
import cors from "cors";


import authRoutes from "./routes/authRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";



const app = express();


app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));

connectDB();


app.use(express.json());
app.use(cookieParser());

// Mount router
app.use("/api/auth", authRoutes);
app.use('/api/wallet', walletRoutes);



const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});