// src/controllers/media.controller.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/db');

// Configure storage path
const MEDIA_STORAGE_PATH = process.env.MEDIA_STORAGE_PATH || path.join(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(MEDIA_STORAGE_PATH)) {
  fs.mkdirSync(MEDIA_STORAGE_PATH, { recursive: true });
}

/**
 * Upload encrypted media
 * @route POST /api/media/upload
 */
const uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    const userId = req.user.id;
    const { expiresIn } = req.body; // Time in seconds
    
    // Generate unique filename
    const fileExtension = path.extname(req.file.originalname);
    const uniqueFilename = `${uuidv4()}${fileExtension}`;
    const filePath = path.join(MEDIA_STORAGE_PATH, uniqueFilename);
    
    // Write file to disk
    fs.writeFileSync(filePath, req.file.buffer);
    
    // Calculate media type
    let mediaType = 'document';
    if (req.file.mimetype.startsWith('image/')) {
      mediaType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      mediaType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      mediaType = 'audio';
    }
    
    // Calculate expiry time if provided
    let expiresAt = null;
    if (expiresIn) {
      expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + parseInt(expiresIn));
    }
    
    // Store media metadata
    const media = {
      filename: uniqueFilename,
      originalName: req.file.originalname,
      mediaType,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: userId,
      expiresAt,
      uri: `/api/media/${uniqueFilename}`
    };
    
    res.status(201).json({
      success: true,
      message: 'Media uploaded successfully',
      data: media
    });
  } catch (error) {
    console.error('Media upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error uploading media',
      error: error.message
    });
  }
};

/**
 * Get media file
 * @route GET /api/media/:filename
 */
const getMedia = async (req, res) => {
  try {
    const { filename } = req.params;
    const userId = req.user.id;
    
    // Security: Sanitize filename to prevent path traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(MEDIA_STORAGE_PATH, sanitizedFilename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }
    
    // Find message related to this media
    const message = await prisma.message.findFirst({
      where: {
        mediaUrl: { contains: sanitizedFilename }
      }
    });
    
    if (message) {
      // Check if user has access to this message
      let hasAccess = false;
      
      // User is sender or receiver
      if (message.senderId === userId || message.receiverId === userId) {
        hasAccess = true;
      }
      
      // User is in the group
      else if (message.groupId) {
        const group = await prisma.group.findUnique({
          where: { id: message.groupId }
        });
        
        if (group && group.memberIds.includes(userId)) {
          hasAccess = true;
        }
      }
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this media'
        });
      }
      
      // Check if message is expired
      if (message.expiresAt && message.expiresAt < new Date()) {
        // Delete the file if expired
        fs.unlinkSync(filePath);
        
        return res.status(404).json({
          success: false,
          message: 'Media has expired'
        });
      }
      
      // If "view once" media, mark as read and delete after sending
      if (message.expiresAt && !message.isRead) {
        // Mark message as read & delivered
        await prisma.message.update({
          where: { id: message.id },
          data: {
            isRead: true,
            isDelivered: true
          }
        });
        
        // Send file
        res.sendFile(filePath);
        
        // Schedule file deletion after sending
        res.on('finish', () => {
          try {
            fs.unlinkSync(filePath);
          } catch (err) {
            console.error('Error deleting view-once file:', err);
          }
        });
        
        return;
      }
    }
    
    // Regular media file
    res.sendFile(filePath);
  } catch (error) {
    console.error('Get media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving media',
      error: error.message
    });
  }
};

/**
 * Delete media file
 * @route DELETE /api/media/:filename
 */
const deleteMedia = async (req, res) => {
  try {
    const { filename } = req.params;
    const userId = req.user.id;
    
    // Security: Sanitize filename to prevent path traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(MEDIA_STORAGE_PATH, sanitizedFilename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }
    
    // Find message related to this media
    const message = await prisma.message.findFirst({
      where: {
        mediaUrl: { contains: sanitizedFilename }
      }
    });
    
    if (message) {
      // Only message sender can delete media
      if (message.senderId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this media'
        });
      }
      
      // Delete the file
      fs.unlinkSync(filePath);
      
      // Update message
      await prisma.message.update({
        where: { id: message.id },
        data: {
          mediaUrl: null,
          mediaType: null
        }
      });
    } else {
      // Delete the file
      fs.unlinkSync(filePath);
    }
    
    res.status(200).json({
      success: true,
      message: 'Media deleted successfully'
    });
  } catch (error) {
    console.error('Delete media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting media',
      error: error.message
    });
  }
};

/**
 * Clean up expired media
 * This could be run as a scheduled job
 */
const cleanupExpiredMedia = async () => {
  try {
    console.log('Running expired media cleanup...');
    
    // Find all messages with expired media
    const expiredMessages = await prisma.message.findMany({
      where: {
        mediaUrl: { not: null },
        expiresAt: { lt: new Date() }
      }
    });
    
    let deletedCount = 0;
    
    for (const message of expiredMessages) {
      if (message.mediaUrl) {
        // Extract filename from URL
        const filename = path.basename(message.mediaUrl);
        const filePath = path.join(MEDIA_STORAGE_PATH, filename);
        
        // Delete file if exists
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
        
        // Update message
        await prisma.message.update({
          where: { id: message.id },
          data: {
            mediaUrl: null,
            mediaType: null
          }
        });
      }
    }
    
    console.log(`Deleted ${deletedCount} expired media files`);
    return deletedCount;
  } catch (error) {
    console.error('Cleanup expired media error:', error);
    throw error;
  }
};

module.exports = {
  uploadMedia,
  getMedia,
  deleteMedia,
  cleanupExpiredMedia
};