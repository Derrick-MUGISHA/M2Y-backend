
const crypto = require('crypto');
const { prisma } = require('../config/db');

/**
 * Create a new group
 * @route POST /api/groups
 */
const createGroup = async (req, res) => {
    try {
        const {
            name,
            description,
            profilePic,
            isPrivate,
            allowAnonymous,
            messageExpiry
        } = req.body;

        const adminId = req.user.id;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a group name'
            });
        }

        // Create new group
        const group = await prisma.group.create({
            data: {
                name,
                description: description || null,
                profilePic: profilePic || null,
                isPrivate: isPrivate !== undefined ? isPrivate : true,
                allowAnonymous: allowAnonymous !== undefined ? allowAnonymous : false,
                messageExpiry: messageExpiry || null,
                adminId,
                memberIds: [adminId]
            }
        });

        // Generate invite code
        const inviteCode = crypto.randomBytes(6).toString('hex');
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7); // 7 days expiry

        await prisma.groupInvite.create({
            data: {
                groupId: group.id,
                inviteCode,
                expiresAt: expiryDate
            }
        });

        res.status(201).json({
            success: true,
            message: 'Group created successfully',
            data: {
                ...group,
                inviteCode
            }
        });
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error creating group',
            error: error.message
        });
    }
};

/**
 * Get group details
 * @route GET /api/groups/:groupId
 */
const getGroupDetails = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await prisma.group.findUnique({
            where: { id: groupId },
            include: {
                admin: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                },
                members: {
                    select: {
                        id: true,
                        username: true,
                        phoneNumber: true,
                        profilePic: true,
                        isOnline: true,
                        lastSeen: true
                    }
                },
                memberNicknames: true,
                groupInvites: {
                    where: {
                        expiresAt: { gt: new Date() }
                    }
                }
            }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Check if user is a member of the group
        const isMember = group.memberIds.includes(userId);
        if (!isMember) {
            return res.status(403).json({
                success: false,
                message: 'You are not a member of this group'
            });
        }

        // Map nicknames to members
        const membersWithNicknames = group.members.map(member => {
            const nickname = group.memberNicknames.find(
                n => n.userId === member.id && n.groupId === groupId
            );

            if (nickname) {
                return {
                    ...member,
                    nickname: nickname.nickname,
                    isVisible: nickname.isVisible
                };
            }

            return member;
        });

        // For non-admin members, filter out invisible members
        let visibleMembers = membersWithNicknames;
        if (userId !== group.adminId) {
            visibleMembers = membersWithNicknames.filter(member => {
                // Admin is always visible
                if (member.id === group.adminId) return true;

                // Current user is always visible to themselves
                if (member.id === userId) return true;

                // Check if member is visible
                return member.isVisible !== false;
            });
        }

        // Get active invite code if user is admin
        let activeInvite = null;
        if (userId === group.adminId && group.groupInvites.length > 0) {
            activeInvite = group.groupInvites[0].inviteCode;
        }

        res.status(200).json({
            success: true,
            data: {
                id: group.id,
                name: group.name,
                description: group.description,
                profilePic: group.profilePic,
                isPrivate: group.isPrivate,
                allowAnonymous: group.allowAnonymous,
                messageExpiry: group.messageExpiry,
                admin: group.admin,
                members: visibleMembers,
                createdAt: group.createdAt,
                updatedAt: group.updatedAt,
                inviteCode: activeInvite
            }
        });
    } catch (error) {
        console.error('Get group details error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error retrieving group details',
            error: error.message
        });
    }
};

/**
 * Get all groups for a user
 * @route GET /api/groups
 */
const getUserGroups = async (req, res) => {
    try {
        const userId = req.user.id;

        const groups = await prisma.group.findMany({
            where: {
                memberIds: {
                    has: userId
                }
            },
            include: {
                admin: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                _count: {
                    select: {
                        members: true
                    }
                }
            }
        });

        res.status(200).json({
            success: true,
            count: groups.length,
            data: groups.map(group => ({
                id: group.id,
                name: group.name,
                description: group.description,
                profilePic: group.profilePic,
                isPrivate: group.isPrivate,
                allowAnonymous: group.allowAnonymous,
                isAdmin: group.adminId === userId,
                memberCount: group._count.members,
                admin: group.admin,
                createdAt: group.createdAt
            }))
        });
    } catch (error) {
        console.error('Get user groups error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error retrieving user groups',
            error: error.message
        });
    }
};

/**
 * Join group via invite code
 * @route POST /api/groups/join
 */
const joinGroup = async (req, res) => {
    try {
        const { inviteCode } = req.body;
        const userId = req.user.id;

        if (!inviteCode) {
            return res.status(400).json({
                success: false,
                message: 'Please provide an invite code'
            });
        }

        // Find group invite
        const groupInvite = await prisma.groupInvite.findUnique({
            where: { inviteCode },
            include: {
                group: true
            }
        });

        if (!groupInvite || groupInvite.expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired invite code'
            });
        }

        const group = groupInvite.group;

        // Check if user is already a member
        if (group.memberIds.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'You are already a member of this group'
            });
        }

        // Add user to group
        await prisma.group.update({
            where: { id: group.id },
            data: {
                memberIds: {
                    push: userId
                }
            }
        });

        res.status(200).json({
            success: true,
            message: 'Successfully joined the group',
            data: {
                groupId: group.id,
                groupName: group.name
            }
        });
    } catch (error) {
        console.error('Join group error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error joining group',
            error: error.message
        });
    }
};

/**
 * Leave a group
 * @route POST /api/groups/:groupId/leave
 */
const leaveGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Check if user is a member
        if (!group.memberIds.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'You are not a member of this group'
            });
        }

        // Admin cannot leave the group, they must delete it or transfer ownership
        if (group.adminId === userId) {
            return res.status(400).json({
                success: false,
                message: 'Group admin cannot leave. Transfer ownership or delete the group'
            });
        }

        // Remove user from group
        await prisma.group.update({
            where: { id: groupId },
            data: {
                memberIds: {
                    set: group.memberIds.filter(id => id !== userId)
                }
            }
        });

        // Remove user's nickname if they have one
        await prisma.memberNickname.deleteMany({
            where: {
                userId,
                groupId
            }
        });

        res.status(200).json({
            success: true,
            message: 'Successfully left the group'
        });
    } catch (error) {
        console.error('Leave group error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error leaving group',
            error: error.message
        });
    }
};

/**
 * Update group settings
 * @route PUT /api/groups/:groupId
 */
const updateGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;
        const {
            name,
            description,
            profilePic,
            isPrivate,
            allowAnonymous,
            messageExpiry
        } = req.body;

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Only admin can update group settings
        if (group.adminId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can update group settings'
            });
        }

        // Update group
        const updatedGroup = await prisma.group.update({
            where: { id: groupId },
            data: {
                name: name || undefined,
                description: description !== undefined ? description : undefined,
                profilePic: profilePic !== undefined ? profilePic : undefined,
                isPrivate: isPrivate !== undefined ? isPrivate : undefined,
                allowAnonymous: allowAnonymous !== undefined ? allowAnonymous : undefined,
                messageExpiry: messageExpiry !== undefined ? messageExpiry : undefined
            }
        });

        res.status(200).json({
            success: true,
            message: 'Group updated successfully',
            data: updatedGroup
        });
    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error updating group',
            error: error.message
        });
    }
};

/**
 * Set/update member nickname in a group
 * @route POST /api/groups/:groupId/nickname
 */
const setMemberNickname = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId, nickname, isVisible } = req.body;
        const currentUserId = req.user.id;

        // If userId not provided, use current user's ID
        const targetUserId = userId || currentUserId;

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Check if both users are members
        if (!group.memberIds.includes(currentUserId) || !group.memberIds.includes(targetUserId)) {
            return res.status(403).json({
                success: false,
                message: 'You or the target user are not members of this group'
            });
        }

        // Only admin can set nickname for other users or toggle visibility
        if (targetUserId !== currentUserId && group.adminId !== currentUserId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can set nicknames for other users'
            });
        }

        // Only admin can toggle visibility
        if (isVisible !== undefined && group.adminId !== currentUserId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can toggle member visibility'
            });
        }

        // Check if nickname already exists
        const existingNickname = await prisma.memberNickname.findUnique({
            where: {
                userId_groupId: {
                    userId: targetUserId,
                    groupId
                }
            }
        });

        let result;

        if (existingNickname) {
            // Update existing nickname
            result = await prisma.memberNickname.update({
                where: { id: existingNickname.id },
                data: {
                    nickname: nickname || undefined,
                    isVisible: isVisible !== undefined ? isVisible : undefined
                }
            });
        } else {
            // Create new nickname
            result = await prisma.memberNickname.create({
                data: {
                    userId: targetUserId,
                    groupId,
                    nickname,
                    isVisible: isVisible !== undefined ? isVisible : true
                }
            });
        }

        res.status(200).json({
            success: true,
            message: 'Nickname updated successfully',
            data: result
        });
    } catch (error) {
        console.error('Set nickname error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error setting nickname',
            error: error.message
        });
    }
};

/**
 * Generate new group invite
 * @route POST /api/groups/:groupId/invite
 */
const generateGroupInvite = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Only admin can generate invites
        if (group.adminId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can generate invites'
            });
        }

        // Expire all existing invites
        await prisma.groupInvite.updateMany({
            where: { groupId },
            data: { expiresAt: new Date() }
        });

        // Generate new invite code
        const inviteCode = crypto.randomBytes(6).toString('hex');
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7); // 7 days expiry

        // Create new invite
        const invite = await prisma.groupInvite.create({
            data: {
                groupId,
                inviteCode,
                expiresAt: expiryDate
            }
        });

        res.status(200).json({
            success: true,
            message: 'New invite code generated',
            data: {
                inviteCode: invite.inviteCode,
                expiresAt: invite.expiresAt
            }
        });
    } catch (error) {
        console.error('Generate invite error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error generating invite',
            error: error.message
        });
    }
};

/**
 * Remove member from group
 * @route DELETE /api/groups/:groupId/members/:memberId
 */
const removeMember = async (req, res) => {
    try {
        const { groupId, memberId } = req.params;
        const userId = req.user.id;

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Only admin can remove members
        if (group.adminId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can remove members'
            });
        }

        // Admin cannot remove themselves
        if (memberId === group.adminId) {
            return res.status(400).json({
                success: false,
                message: 'Admin cannot be removed from the group'
            });
        }

        // Check if user is a member
        if (!group.memberIds.includes(memberId)) {
            return res.status(400).json({
                success: false,
                message: 'User is not a member of this group'
            });
        }

        // Remove member
        await prisma.group.update({
            where: { id: groupId },
            data: {
                memberIds: {
                    set: group.memberIds.filter(id => id !== memberId)
                }
            }
        });

        // Remove member's nickname
        await prisma.memberNickname.deleteMany({
            where: {
                userId: memberId,
                groupId
            }
        });

        res.status(200).json({
            success: true,
            message: 'Member removed successfully'
        });
    } catch (error) {
        console.error('Remove member error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error removing member',
            error: error.message
        });
    }
};

/**
 * Transfer group ownership
 * @route POST /api/groups/:groupId/transfer
 */
const transferOwnership = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { newAdminId } = req.body;
        const userId = req.user.id;

        if (!newAdminId) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a new admin ID'
            });
        }

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Only current admin can transfer ownership
        if (group.adminId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can transfer ownership'
            });
        }

        // Check if new admin is a member
        if (!group.memberIds.includes(newAdminId)) {
            return res.status(400).json({
                success: false,
                message: 'New admin must be a member of the group'
            });
        }

        // Transfer ownership
        await prisma.group.update({
            where: { id: groupId },
            data: {
                adminId: newAdminId
            }
        });

        res.status(200).json({
            success: true,
            message: 'Group ownership transferred successfully'
        });
    } catch (error) {
        console.error('Transfer ownership error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error transferring ownership',
            error: error.message
        });
    }
};

/**
 * Delete group
 * @route DELETE /api/groups/:groupId
 */
const deleteGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user.id;

        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }

        // Only admin can delete group
        if (group.adminId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the group admin can delete the group'
            });
        }

        // Delete group
        await prisma.group.delete({
            where: { id: groupId }
        });

        res.status(200).json({
            success: true,
            message: 'Group deleted successfully'
        });
    } catch (error) {
        console.error('Delete group error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error deleting group',
            error: error.message
        });
    }
};

module.exports = {
    createGroup,
    getGroupDetails,
    getUserGroups,
    joinGroup,
    leaveGroup,
    updateGroup,
    setMemberNickname,
    generateGroupInvite,
    removeMember,
    transferOwnership,
    deleteGroup
};