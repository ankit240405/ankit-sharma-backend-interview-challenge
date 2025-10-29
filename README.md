# 🧠 Task Synchronization System

## 1️⃣ Approach to the Synchronization Problem

This project implements an **offline-first task management system** designed to ensure seamless operation regardless of network connectivity. The core objective was to maintain data consistency between the local database and the remote server through efficient synchronization.

### Key Design Decisions

- **Offline-first architecture:** All task operations (create, update, delete) are performed locally and persisted in a SQLite database, ensuring uninterrupted functionality even when offline.  
- **Sync queue mechanism:** Each local operation is recorded in a `sync_queue` table along with its type (`create`, `update`, or `delete`), payload, and retry count.  
- **Batch synchronization:** On reconnection, queued operations are sent to the server in controlled batches (default: 50 items) via a dedicated `SyncService`.  
- **Conflict resolution:** A **Last-Write-Wins** policy is used, where the record with the latest `updated_at` timestamp is considered the source of truth.  
- **Retry and error handling:** Each failed operation is retried up to three times before being flagged for review, ensuring robustness without blocking other operations.  
- **Soft deletion:** Instead of permanently removing tasks, deletions are handled through an `is_deleted` flag to preserve historical integrity during sync.

---

## 2️⃣ Assumptions

- The system supports a **single-user workflow**; authentication was not required for this exercise.  
- The **server generates and assigns `server_id`** upon the first successful synchronization.  
- **Timestamps** are stored and compared in **ISO 8601 format** for consistency across systems.  
- **Network interruptions** do not affect local task operations; all changes are queued until connectivity is restored.  
- Synchronization can be triggered manually through `/api/sync` or automatically when the client detects an online status.  
- The default batch size is **50**, configurable via the `BATCH_SIZE` environment variable.

---

## 3️⃣ Running and Testing the Solution

### 🧩 Prerequisites

- Node.js ≥ 18  
- npm ≥ 9  

### ⚙️ Setup Instructions

```bash
git clone <repository-url>
cd task-sync-api
npm install
```

Create a `.env` file in the project root:

```bash
API_BASE_URL=https://your-server-endpoint.com
BATCH_SIZE=50
```

### ▶️ Running the Server

```bash
npm run dev
```

The application will start on:  
**https://ankit-sharma-backend-interview-challenge-4rk8.onrender.com/api/tasks**

### 🧪 Testing and Linting

```bash
npm test          # Execute test suite
npm run lint      # Perform ESLint checks
npm run typecheck # Validate TypeScript types
```

All commands should complete successfully with **zero errors or warnings** ✅  

---

## 4️⃣ Linting Configuration

The following ESLint configuration (`.eslintrc.json`) was used to maintain clean and consistent code quality:

```json
{
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "env": {
    "node": true,
    "es6": true
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": "off"
  },
  "ignorePatterns": ["node_modules/", "dist/", "build/"]
}
```

---

## ✅ Verification Checklist

- All tests pass (`npm test`)  
- No ESLint issues (`npm run lint`)  
- No TypeScript type errors (`npm run typecheck`)  
- Offline operations function correctly and synchronize successfully when online  

---
