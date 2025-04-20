// src/routes/auth.routes.js
const express = require('express');
const authController = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// Public routes
router.post('/register', authController.register);
router.post('/verify', authController.verifyPhone);
router.post('/login', authController.login);

// Protected routes
router.get('/profile', protect, authController.getProfile);
router.put('/profile', protect, authController.updateProfile);
router.get('/search', protect, authController.searchUsers);
router.put('/status', protect, authController.setOnlineStatus);

module.exports = router;

// src/routes/message.routes.js
const express = require('express');
const messageController = require('../controllers/message.controller');
const { protect } = require('../middlewares/auth.middleware');

const messageRouter = express.Router();

// All routes are protected
messageRouter.use(protect);

messageRouter.post('/', messageController.sendMessage);
messageRouter.get('/user/:userId', messageController.getMessagesByUser);
messageRouter.get('/group/:groupId', messageController.getGroupMessages);
messageRouter.put('/read/:messageId', messageController.markMessageRead);
messageRouter.delete('/:messageId', messageController.deleteMessage);
messageRouter.post('/reaction/:messageId', messageController.addReaction);
messageRouter.delete('/reaction/:messageId', messageController.removeReaction);

module.exports = messageRouter;

// src/routes/group.routes.js
const express = require('express');
const groupController = require('../controllers/group.controller');
const { protect } = require('../middlewares/auth.middleware');

const groupRouter = express.Router();

// All routes are protected
groupRouter.use(protect);
    
groupRouter.post('/', groupController.createGroup);
groupRouter.get('/', groupController.getUserGroups);
groupRouter.get('/:groupId', groupController.getGroupDetails);
groupRouter.put('/:groupId', groupController.updateGroup);
groupRouter.post('/join', groupController.joinGroup);
groupRouter.post('/:groupId/leave', groupController.leaveGroup);
groupRouter.post('/:groupId/nickname', groupController.setMemberNickname);
groupRouter.post('/:groupId/invite', groupController.generateGroupInvite);
groupRouter.delete('/:groupId/members/:memberId', groupController.removeMember);
groupRouter.post('/:groupId/transfer', groupController.transferOwnership);
groupRouter.delete('/:groupId', groupController.deleteGroup);

module.exports = groupRouter;

// src/routes/media.routes.js
const express = require('express');
const multer = require('multer');
const mediaController = require('../controllers/media.controller');
const { protect } = require('../middlewares/auth.middleware');

const mediaRouter = express.Router();

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});                                                                                        

// All routes are protected
mediaRouter.use(protect);

mediaRouter.post('/upload', upload.single('file'), mediaController.uploadMedia);
mediaRouter.get('/:filename', mediaController.getMedia);
mediaRouter.delete('/:filename', mediaController.deleteMedia);

module.exports = mediaRouter;