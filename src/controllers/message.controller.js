// src/controllers/message.controller.js
const { prisma } = require('../config/db');

/**
 * Send a new message (1-1 or group)
 * @route POST /api/messages
 */
const sendMessage = async (req, res) => {
  try {
    const { 
      receiverId, 
      groupId, 
      content, 
      encryptedKey,
      mediaUrl,
      mediaType,
      isAnonymous,
      expiresAt
    } = req.body;
    
    const senderId = req.user.id;
    
    // Validate that either receiverId or groupId is provided
    if (!receiverId && !groupId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a receiver ID or group ID'
      });
    }
    
    // If it's a group message, check if user is a member of the group
    if (groupId) {
      const group = await prisma.group.findUnique({
        where: { id: groupId },
        include: { members: true }
      });
      
      if (!group) {
        return res.status(404).json({
          success: false, 
          message: 'Group not found'
        });
      }
      
      const isMember = group.memberIds.includes(senderId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this group'
        });
      }
      
      // Check if anonymous messaging is allowed in this group
      if (isAnonymous && !group.allowAnonymous) {
        return res.status(403).json({
          success: false,
          message: 'Anonymous messaging is not allowed in this group'
        });
      }
      
      // If group has message expiry, use it if not explicitly provided
      if (!expiresAt && group.messageExpiry) {
        const expiryTime = new Date();
        expiryTime.setSeconds(expiryTime.getSeconds() + group.messageExpiry);
        expiresAt = expiryTime;
      }
    }
    
    // Create new message
    const message = await prisma.message.create({
      data: {
        senderId,
        receiverId: receiverId || null,
        groupId: groupId || null,
        content,
        encryptedKey,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        isAnonymous: isAnonymous || false,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });
    
    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error sending message',
      error: error.message
    });
  }
};

/**
 * Get messages between two users
 * @route GET /api/messages/:userId
 */
const getMessagesByUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const otherUserId = req.params.userId;
    
    // Get messages where current user is either sender or receiver
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          {
            senderId: currentUserId,
            receiverId: otherUserId
          },
          {
            senderId: otherUserId,
            receiverId: currentUserId
          }
        ],
        deleted: false,
        // Don't return expired messages
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: {
        createdAt: 'asc'
      },
      include: {
        reactions: true
      }
    });
    
    // Mark received messages as delivered
    await prisma.message.updateMany({
      where: {
        senderId: otherUserId,
        receiverId: currentUserId,
        isDelivered: false
      },
      data: {
        isDelivered: true
      }
    });
    
    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving messages',
      error: error.message
    });
  }
};

/**
 * Get messages from a group
 * @route GET /api/messages/group/:groupId
 */
const getGroupMessages = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const groupId = req.params.groupId;
    
    // Check if user is a member of the group
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { 
        members: true,
        memberNicknames: true
      }
    });
    
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }
    
    const isMember = group.memberIds.includes(currentUserId);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }
    
    // Get group messages
    const messages = await prisma.message.findMany({
      where: {
        groupId,
        deleted: false,
        // Don't return expired messages
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: {
        createdAt: 'asc'
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            phoneNumber: true,
            profilePic: true
          }
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      }
    });
    
    // Map nicknames to messages
    const messagesWithNicknames = messages.map(message => {
      // Don't modify the sender info for anonymous messages
      if (message.isAnonymous) {
        return {
          ...message,
          sender: {
            id: null,
            username: 'Anonymous',
            profilePic: null
          }
        };
      }
      
      // Find nickname for sender if exists
      const nickname = group.memberNicknames.find(
        n => n.userId === message.senderId && n.groupId === groupId
      );
      
      if (nickname) {
        return {
          ...message,
          sender: {
            ...message.sender,
            username: nickname.nickname,
            isNickname: true,
            isVisible: nickname.isVisible
          }
        };
      }
      
      return message;
    });
    
    res.status(200).json({
      success: true,
      count: messagesWithNicknames.length,
      data: messagesWithNicknames
    });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving group messages',
      error: error.message
    });
  }
};

/**
 * Mark message as read
 * @route PUT /api/messages/read/:messageId
 */
const markMessageRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }
    
    // Check if user is the receiver or a member of the group
    let canMarkAsRead = false;
    
    if (message.receiverId === userId) {
      canMarkAsRead = true;
    } else if (message.groupId) {
      const group = await prisma.group.findUnique({
        where: { id: message.groupId },
        include: { members: true }
      });
      
      if (group && group.memberIds.includes(userId)) {
        canMarkAsRead = true;
      }
    }
    
    if (!canMarkAsRead) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to mark this message as read'
      });
    }
    
    // Update message
    await prisma.message.update({
      where: { id: messageId },
      data: { 
        isRead: true,
        isDelivered: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Message marked as read'
    });
  } catch (error) {
    console.error('Mark message read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while marking message as read',
      error: error.message
    });
  }
};

/**
 * Delete message for everyone
 * @route DELETE /api/messages/:messageId
 */
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }
    
    // Only message sender can delete for everyone
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this message'
      });
    }
    
    // Delete the message (mark as deleted)
    await prisma.message.update({
      where: { id: messageId },
      data: { deleted: true }
    });
    
    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting message',
      error: error.message
    });
  }
};

/**
 * Add reaction to a message
 * @route POST /api/messages/reaction/:messageId
 */
const addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id;
    
    if (!emoji) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an emoji'
      });
    }
    
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        reactions: true
      }
    });
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }
    
    // Check if user has permission to react to the message
    let canReact = false;
    
    if (message.receiverId === userId || message.senderId === userId) {
      canReact = true;
    } else if (message.groupId) {
      const group = await prisma.group.findUnique({
        where: { id: message.groupId },
        include: { members: true }
      });
      
      if (group && group.memberIds.includes(userId)) {
        canReact = true;
      }
    }
    
    if (!canReact) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to react to this message'
      });
    }
    
    // Check if user already reacted to the message
    const existingReaction = message.reactions.find(r => r.userId === userId);
    
    if (existingReaction) {
      // Update existing reaction
      await prisma.reaction.update({
        where: { id: existingReaction.id },
        data: { emoji }
      });
    } else {
      // Create new reaction
      await prisma.reaction.create({
        data: {
          messageId,
          userId,
          emoji
        }
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Reaction added successfully'
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding reaction',
      error: error.message
    });
  }
};

/**
 * Remove reaction from a message
 * @route DELETE /api/messages/reaction/:messageId
 */
const removeReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const reaction = await prisma.reaction.findFirst({
      where: {
        messageId,
        userId
      }
    });
    
    if (!reaction) {
      return res.status(404).json({
        success: false,
        message: 'Reaction not found'
      });
    }
    
    // Delete reaction
    await prisma.reaction.delete({
      where: { id: reaction.id }
    });
    
    res.status(200).json({
      success: true,
      message: 'Reaction removed successfully'
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing reaction',
      error: error.message
    });
  }
};

module.exports = {
  sendMessage,
  getMessagesByUser,
  getGroupMessages,
  markMessageRead,
  deleteMessage,
  addReaction,
  removeReaction
};