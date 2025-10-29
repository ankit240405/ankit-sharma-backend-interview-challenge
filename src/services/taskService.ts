import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types';
import { Database } from '../db/database';

export class TaskService {
  constructor(private db: Database) {}

  async createTask(taskData: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      title: taskData.title,
      description: taskData.description,
      completed: taskData.completed || false,
      created_at: new Date(),
      updated_at: new Date(),
      is_deleted: false,
      sync_status: 'pending',
      server_id: taskData.server_id,
      last_synced_at: taskData.last_synced_at
    };

    const sql = `
      INSERT INTO tasks (
        id, title, description, completed, created_at, 
        updated_at, is_deleted, sync_status, server_id, last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      task.id,
      task.title,
      task.description || null,
      task.completed ? 1 : 0,
      task.created_at.toISOString(),
      task.updated_at.toISOString(),
      task.is_deleted ? 1 : 0,
      task.sync_status || 'pending',
      task.server_id || null,
      task.last_synced_at?.toISOString() || null
    ]);

    
    const syncQueueSql = `
      INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(syncQueueSql, [
      uuidv4(),
      task.id,
      'create',
      JSON.stringify(task),
      task.created_at.toISOString(),
      0
    ]);

    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    const sql = `SELECT * FROM tasks WHERE id = ? AND is_deleted = 0`;
    const row = await this.db.get(sql, [id]);
    
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id,
      last_synced_at: row.last_synced_at ? new Date(row.last_synced_at) : undefined
    };
  }

  async getAllTasks(): Promise<Task[]> {
    const sql = `
      SELECT * FROM tasks 
      WHERE is_deleted = 0
      ORDER BY created_at DESC
    `;

    const rows = await this.db.all(sql);
    
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id,
      last_synced_at: row.last_synced_at ? new Date(row.last_synced_at) : undefined
    }));
  }

  async getTasksNeedingSync(): Promise<Task[]> {
    const sql = `
      SELECT * FROM tasks 
      WHERE sync_status = 'pending' AND is_deleted = 0
      ORDER BY updated_at DESC
    `;
    const rows = await this.db.all(sql);
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id,
      last_synced_at: row.last_synced_at ? new Date(row.last_synced_at) : undefined
    }));
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existingTask = await this.getTask(id);
    
    if (!existingTask) {
      return null;
    }

    const updatedTask: Task = {
      ...existingTask,
      ...updates,
      id: existingTask.id,
      updated_at: new Date(),
      sync_status: 'pending'
    };

    const sql = `
      UPDATE tasks 
      SET title = ?, description = ?, completed = ?, updated_at = ?, 
          sync_status = ?, server_id = ?, last_synced_at = ?
      WHERE id = ?
    `;

    await this.db.run(sql, [
      updatedTask.title,
      updatedTask.description || null,
      updatedTask.completed ? 1 : 0,
      updatedTask.updated_at.toISOString(),
      updatedTask.sync_status,
      updatedTask.server_id || null,
      updatedTask.last_synced_at?.toISOString() || null,
      id
    ]);

    
    const syncQueueSql = `
      INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(syncQueueSql, [
      uuidv4(),
      updatedTask.id,
      'update',
      JSON.stringify(updatedTask),
      updatedTask.updated_at.toISOString(),
      0
    ]);

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    
    if (!task) {
      return false;
    }

    const now = new Date();
    const sql = `
      UPDATE tasks 
      SET is_deleted = 1, updated_at = ?, sync_status = 'pending'
      WHERE id = ?
    `;

    await this.db.run(sql, [now.toISOString(), id]);

    
    const syncQueueSql = `
      INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(syncQueueSql, [
      uuidv4(),
      id,
      'delete',
      JSON.stringify({ id }),
      now.toISOString(),
      0
    ]);

    return true;
  }
}