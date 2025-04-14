
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const connectDB = async () => {
    try {
        
        await mongoose.connect(process.env.DATABASE_URL);
        console.log('MongoDB connected successfully');


        // Test Prisma connection

        await prisma.$connect();
        console.log('Prisma connected successfully');

        return { mongoose, prisma };
    } catch (error) {
        console.error(`MongoDB connection error: ${error.message}`);
        process.exit(1); // Exit the process with failure
    }
};

module.exports = { connectDB, prisma };