import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { SyncService } from '../services/syncService';
import { Database } from '../db/database';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tasks = await taskService.getAllTasks();
    res.json(tasks);
  } catch {
    res.status(500).json({ 
      error: 'Failed to fetch tasks',
      timestamp: new Date(),
      path: req.path
    });
  }
});
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ 
        error: 'Task not found',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }
    res.json(task);
  } catch {
    res.status(500).json({ 
      error: 'Failed to fetch task',
      timestamp: new Date(),
      path: req.path
    });
  }
});

  router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({
        error: 'Title is required and must be a non-empty string',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    const task = await taskService.createTask({
      title: title.trim(),
      description: description?.trim(),
      completed: false,
      is_deleted: false
    });

    await syncService.addToSyncQueue(task.id, 'create', task);

    res.status(201).json(task);
  } catch (error) {
    console.error('Failed to create task:', error);
    res.status(500).json({
      error: 'Failed to create task',
      timestamp: new Date(),
      path: req.path
    });
  }
});

  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, completed } = req.body;

    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      res.status(400).json({
        error: 'Title must be a non-empty string',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    if (completed !== undefined && typeof completed !== 'boolean') {
      res.status(400).json({
        error: 'Completed must be a boolean',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    const updates: any = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim();
    if (completed !== undefined) updates.completed = completed;

    const updatedTask = await taskService.updateTask(req.params.id, updates);

    if (!updatedTask) {
      res.status(404).json({
        error: 'Task not found',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    await syncService.addToSyncQueue(updatedTask.id, 'update', updatedTask);

    res.json(updatedTask);
  } catch (error) {
    console.error('Failed to update task:', error);
    res.status(500).json({
      error: 'Failed to update task',
      timestamp: new Date(),
      path: req.path
    });
  }
});

  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const task = await taskService.getTask(req.params.id);

    if (!task) {
      res.status(404).json({
        error: 'Task not found',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    const deleted = await taskService.deleteTask(req.params.id);

    if (!deleted) {
      res.status(404).json({
        error: 'Task not found',
        timestamp: new Date(),
        path: req.path
      });
      return;
    }

    await syncService.addToSyncQueue(req.params.id, 'delete', task);

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete task:', error);
    res.status(500).json({
      error: 'Failed to delete task',
      timestamp: new Date(),
      path: req.path
    });
  }
});

  return router;
}