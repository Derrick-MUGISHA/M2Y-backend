const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { prisma } = require('../config/db');
const { generateToken } = require('../services/jwt.service');
const { generateOTP, saveOTP, sendOTPViaSMS, verifyOTP } = require('../utils/otp.util');

/**
 * Register a new user
 * @route POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { phoneNumber, publicKey } = req.body;
    
    if (!phoneNumber || !publicKey) {
      return res.status(400).json({
        success: false,
        message: 'Please provide phone number and public key'
      });
    }
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { phoneNumber }
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this phone number'
      });
    }
    
    // Create new user
    const newUser = await prisma.user.create({
      data: {
        phoneNumber,
        publicKey,
      }
    });
    
    // Generate and save OTP
    const otp = generateOTP();
    await saveOTP(newUser.id, otp);
    
    // Send OTP via SMS
    const smsSent = await sendOTPViaSMS(phoneNumber, otp);
    
    if (!smsSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code'
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Registration successful! Please verify your phone number',
      userId: newUser.id
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message
    });
  }
};

/**
 * Verify phone number with OTP
 * @route POST /api/auth/verify
 */
const verifyPhone = async (req, res) => {
  try {
    const { userId, otp } = req.body;
    
    if (!userId || !otp) {
      return res.status(400).json({
        success: false, 
        message: 'Please provide user ID and OTP'
      });
    }
    
    // Verify OTP
    const isValid = await verifyOTP(userId, otp);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }
    
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate JWT token
    const token = generateToken(user);
    
    res.status(200).json({
      success: true,
      message: 'Phone verification successful',
      token,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        username: user.username,
        profilePic: user.profilePic,
        status: user.status,
        twoFactorAuth: user.twoFactorAuth
      }
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during verification',
      error: error.message
    });
  }
};

/**
 * Login existing user
 * @route POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please provide phone number'
      });
    }
    
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { phoneNumber }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate and save OTP for login
    const otp = generateOTP();
    await saveOTP(user.id, otp);
    
    // Send OTP via SMS
    const smsSent = await sendOTPViaSMS(phoneNumber, otp);
    
    if (!smsSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      userId: user.id
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message
    });
  }
};

/**
 * Update user profile
 * @route PUT /api/auth/profile
 */
const updateProfile = async (req, res) => {
  try {
    const { username, status, profilePic, twoFactorAuth, email } = req.body;
    const userId = req.user.id;
    
    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        username: username || undefined,
        status: status || undefined,
        profilePic: profilePic || undefined,
        twoFactorAuth: twoFactorAuth !== undefined ? twoFactorAuth : undefined,
        email: email || undefined,
        twoFactorType: twoFactorAuth && email ? 'email' : (twoFactorAuth ? 'sms' : undefined)
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        phoneNumber: updatedUser.phoneNumber,
        username: updatedUser.username,
        profilePic: updatedUser.profilePic,
        status: updatedUser.status,
        twoFactorAuth: updatedUser.twoFactorAuth,
        email: updatedUser.email,
        twoFactorType: updatedUser.twoFactorType
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during profile update',
      error: error.message
    });
  }
};

/**
 * Get user profile
 * @route GET /api/auth/profile
 */
const getProfile = async (req, res) => {
  try {
    const user = req.user;
    
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        username: user.username,
        profilePic: user.profilePic,
        status: user.status,
        lastSeen: user.lastSeen,
        isOnline: user.isOnline,
        twoFactorAuth: user.twoFactorAuth,
        email: user.email,
        twoFactorType: user.twoFactorType,
        publicKey: user.publicKey
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile',
      error: error.message
    });
  }
};

/**
 * Search users by phone number or username
 * @route GET /api/auth/search
 */
const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a search query'
      });
    }
    
    // Search users by phone number or username
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { phoneNumber: { contains: query } },
          { username: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        phoneNumber: true,
        username: true,
        profilePic: true,
        status: true,
        lastSeen: true,
        isOnline: true,
        publicKey: true
      }
    });
    
    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching users',
      error: error.message
    });
  }
};

/**
 * Set user's online status
 * @route PUT /api/auth/status
 */
const setOnlineStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const userId = req.user.id;
    
    // Update user's online status
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isOnline: isOnline !== undefined ? isOnline : true,
        lastSeen: new Date()
      }
    });
    
    res.status(200).json({
      success: true,
      message: `User is now ${isOnline ? 'online' : 'offline'}`,
      isOnline: updatedUser.isOnline,
      lastSeen: updatedUser.lastSeen
    });
  } catch (error) {
    console.error('Update online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating online status',
      error: error.message
    });
  }
};

module.exports = {
  register,
  verifyPhone,
  login,
  updateProfile,
  getProfile,
  searchUsers,
  setOnlineStatus
};