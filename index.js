import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

app.use(cors({
  origin: "*",
  credentials: true
}));
app.use(express.json());

// Store connected users
const connectedUsers = new Map();
const typingUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle user authentication
  socket.on('authenticate', (data) => {
    const { userId, username } = data;
    connectedUsers.set(socket.id, { userId, username });
    socket.userId = userId;
    socket.username = username;
    
    console.log(`User ${username} authenticated with ID ${userId}`);
    
    // Broadcast user online status
    socket.broadcast.emit('user_online', { userId, username });
  });

  // Handle joining channels
  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
    console.log(`User ${socket.username} joined channel ${channelId}`);
  });

  // Handle leaving channels
  socket.on('leave_channel', (channelId) => {
    socket.leave(channelId);
    console.log(`User ${socket.username} left channel ${channelId}`);
  });

  // Handle sending messages
  socket.on('send_message', (data) => {
    const { channelId, message } = data;
    
    // Broadcast message to all users in the channel except sender
    socket.to(channelId).emit('new_message', message);
    
    console.log(`Message sent to channel ${channelId}:`, message.content);
  });

  // Handle typing indicators
  socket.on('typing_start', (data) => {
    const { channelId } = data;
    const userId = socket.userId;
    const username = socket.username;
    
    if (!typingUsers.has(channelId)) {
      typingUsers.set(channelId, new Set());
    }
    
    typingUsers.get(channelId).add({ userId, username });
    
    socket.to(channelId).emit('user_typing_start', {
      userId,
      username,
      channelId,
    });
  });

  socket.on('typing_stop', (data) => {
    const { channelId } = data;
    const userId = socket.userId;
    
    if (typingUsers.has(channelId)) {
      const channelTypingUsers = typingUsers.get(channelId);
      channelTypingUsers.forEach(user => {
        if (user.userId === userId) {
          channelTypingUsers.delete(user);
        }
      });
      
      if (channelTypingUsers.size === 0) {
        typingUsers.delete(channelId);
      }
    }
    
    socket.to(channelId).emit('user_typing_stop', {
      userId,
      channelId,
    });
  });

  // Handle message reactions
  socket.on('add_reaction', (data) => {
    const { messageId, emoji, channelId } = data;
    socket.to(channelId).emit('reaction_added', {
      messageId,
      emoji,
      userId: socket.userId,
      username: socket.username,
    });
  });

  socket.on('remove_reaction', (data) => {
    const { messageId, emoji, channelId } = data;
    socket.to(channelId).emit('reaction_removed', {
      messageId,
      emoji,
      userId: socket.userId,
    });
  });

  // Handle message editing
  socket.on('edit_message', (data) => {
    const { messageId, content, channelId } = data;
    socket.to(channelId).emit('message_edited', {
      messageId,
      content,
      editedAt: new Date().toISOString(),
    });
  });

  // Handle message deletion
  socket.on('delete_message', (data) => {
    const { messageId, channelId } = data;
    socket.to(channelId).emit('message_deleted', { messageId });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const user = connectedUsers.get(socket.id);
    if (user) {
      // Broadcast user offline status
      socket.broadcast.emit('user_offline', { userId: user.userId });
      connectedUsers.delete(socket.id);
    }
    
    // Clean up typing indicators
    typingUsers.forEach((users, channelId) => {
      users.forEach(typingUser => {
        if (typingUser.userId === socket.userId) {
          users.delete(typingUser);
          socket.to(channelId).emit('user_typing_stop', {
            userId: socket.userId,
            channelId,
          });
        }
      });
    });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});