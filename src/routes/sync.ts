import { Router, Request, Response } from 'express';
import { SyncService } from '../services/syncService';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';
import { BatchSyncRequest, BatchSyncResponse } from '../types';

export function createSyncRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  router.post('/sync', async (req: Request, res: Response) => {
  try {
    const isOnline = await syncService.checkConnectivity();
    
    if (!isOnline) {
      res.status(503).json({  // Remove 'return' here
        error: 'Server is not reachable',
        timestamp: new Date(),
        path: req.path
      });
    } else {
      const result = await syncService.sync();
      res.json(result);
    }
  } catch (error) {
    console.error('Sync failed:', error);
    res.status(500).json({
      error: 'Sync failed',
      timestamp: new Date(),
      path: req.path
    });
  }
});

  router.get('/status', async (req: Request, res: Response) => {
    try {
      const pendingSql = 'SELECT COUNT(*) as count FROM sync_queue WHERE retry_count < 3';
      const pendingResult = await db.get(pendingSql);
      const pendingCount = pendingResult?.count || 0;

      const lastSyncSql = 'SELECT MAX(last_synced_at) as last_sync FROM tasks WHERE last_synced_at IS NOT NULL';
      const lastSyncResult = await db.get(lastSyncSql);
      const lastSyncTimestamp = lastSyncResult?.last_sync || null;

      const isOnline = await syncService.checkConnectivity();

      const queueSizeSql = 'SELECT COUNT(*) as count FROM sync_queue';
      const queueSizeResult = await db.get(queueSizeSql);
      const queueSize = queueSizeResult?.count || 0;

      res.json({
        pending_sync_count: pendingCount,
        last_sync_timestamp: lastSyncTimestamp,
        is_online: isOnline,
        sync_queue_size: queueSize
      });
    } catch (error) {
      console.error('Failed to get sync status:', error);
      res.status(500).json({
        error: 'Failed to retrieve sync status',
        timestamp: new Date(),
        path: req.path
      });
    }
  });

 router.post('/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const batchRequest: BatchSyncRequest = req.body;

    if (!batchRequest.items || !Array.isArray(batchRequest.items)) {
      res.status(400).json({
        error: 'Invalid batch request: items array is required',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    const response: BatchSyncResponse = {
      processed_items: []
    };

    for (const item of batchRequest.items) {
      try {
        let serverTask;
        
        if (item.operation === 'create') {
          serverTask = await taskService.createTask({
            title: item.data.title!,
            description: item.data.description,
            completed: item.data.completed || false,
            is_deleted: false
          });
          
          response.processed_items.push({
            client_id: item.id,
            server_id: serverTask.id,
            status: 'success',
            resolved_data: serverTask
          });
        } else if (item.operation === 'update') {
          const existingTask = await taskService.getTask(item.task_id);
          
          if (!existingTask) {
            response.processed_items.push({
              client_id: item.id,
              server_id: item.task_id,
              status: 'error',
              error: 'Task not found'
            });
            continue;
          }

          if (existingTask.updated_at > item.data.updated_at!) {
            response.processed_items.push({
              client_id: item.id,
              server_id: item.task_id,
              status: 'conflict',
              resolved_data: existingTask
            });
          } else {
            serverTask = await taskService.updateTask(item.task_id, item.data);
            response.processed_items.push({
              client_id: item.id,
              server_id: item.task_id,
              status: 'success',
              resolved_data: serverTask!
            });
          }
        } else if (item.operation === 'delete') {
          const deleted = await taskService.deleteTask(item.task_id);
          
          if (deleted) {
            response.processed_items.push({
              client_id: item.id,
              server_id: item.task_id,
              status: 'success'
            });
          } else {
            response.processed_items.push({
              client_id: item.id,
              server_id: item.task_id,
              status: 'error',
              error: 'Task not found'
            });
          }
        }
      } catch (itemError) {
        response.processed_items.push({
          client_id: item.id,
          server_id: item.task_id,
          status: 'error',
          error: (itemError as Error).message
        });
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Batch sync failed:', error);
    res.status(500).json({
      error: 'Batch sync failed',
      timestamp: new Date(),
      path: req.path
    });
  }
});

 router.get('/health', (_req:Request,res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

  return router;
}