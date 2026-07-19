import mongoose from "mongoose";
import { env } from "./env";

let isConnected = false;

export async function connectMongoDB(): Promise<void> {
  try {
    await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    console.log("MongoDB connected");
  } catch (error) {
    isConnected = false;
    console.error("MongoDB connection failed:", (error as Error).message);
    throw error;
  }
}

export async function disconnectMongoDB(): Promise<void> {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    console.log("MongoDB disconnected");
  }
}

export function getMongoStatus(): "connected" | "disconnected" {
  return mongoose.connection.readyState === 1 ? "connected" : "disconnected";
}
