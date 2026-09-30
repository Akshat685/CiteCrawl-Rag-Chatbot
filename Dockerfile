# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM node:22-alpine AS deps

# Set working directory inside the container
WORKDIR /app

# Copy only package files first (for layer caching — see guide)
COPY package.json package-lock.json ./

# Install exact dependency versions from lockfile
RUN npm ci --legacy-peer-deps


# ============================================================
# Stage 2: Build the application
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy installed dependencies from Stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy all source code (respects .dockerignore)
COPY . .

# Build the Next.js production bundle
RUN npm run build


# ============================================================
# Stage 3: Production runner (minimal image)
# ============================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone server and static assets from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Document the port the app listens on
EXPOSE 3000

# Start the standalone Next.js server
CMD ["node", "server.js"]
