import axios from 'axios';
import { Task, SyncQueueItem, SyncResult, BatchSyncRequest, BatchSyncResponse } from '../types';
import { Database } from '../db/database';
import { TaskService } from './taskService';
import { v4 as uuidv4 } from 'uuid';

export class SyncService {
  private apiUrl: string;
  private readonly SYNC_BATCH_SIZE: number;
  private readonly MAX_RETRY_COUNT: number = 3;
  private readonly HEALTH_CHECK_TIMEOUT: number = 5000;
  
  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api'
  ) {
    this.apiUrl = apiUrl;
    this.SYNC_BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE) || 10;
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced_items: 0,
      failed_items: 0,
      errors: []
    };

    try {
      const isOnline = await this.checkConnectivity();
      if (!isOnline) {
        throw new Error('Server is not reachable');
      }

      const queueItems = await this.getSyncQueueItems();
      
      if (queueItems.length === 0) {
        return result;
      }

      const batches = this.createBatches(queueItems, this.SYNC_BATCH_SIZE);

      for (const batch of batches) {
        try {
          const batchResponse = await this.processBatch(batch);
          
          console.log('Batch items:', batch.map(b => ({ id: b.id, task_id: b.task_id })));
          console.log('Processed items:', batchResponse.processed_items.map(p => ({ client_id: p.client_id, status: p.status })));
          
          for (const processedItem of batchResponse.processed_items) {
            // FIX: Look for queue item by task_id instead of id
            const queueItem = batch.find(item => item.task_id === processedItem.client_id);
            
            console.log(`Looking for queue item with task_id: ${processedItem.client_id}, found:`, queueItem ? 'YES' : 'NO');
            
            if (!queueItem) {
              console.log(`No queue item found for client_id: ${processedItem.client_id}`);
              continue;
            }

            if (processedItem.status === 'success') {
              await this.updateSyncStatus(
                queueItem.id,
                queueItem.task_id,
                'synced',
                { server_id: processedItem.server_id }
              );
              result.synced_items++;
              console.log(`Successfully synced item: ${queueItem.id}, count: ${result.synced_items}`);
            } else if (processedItem.status === 'conflict' && processedItem.resolved_data) {
              const localTask = await this.taskService.getTask(queueItem.task_id);
              if (localTask) {
                const resolvedTask = await this.resolveConflict(localTask, processedItem.resolved_data);
                
                const sql = `
                  UPDATE tasks 
                  SET title = ?, description = ?, completed = ?, updated_at = ?, 
                      sync_status = ?, server_id = ?, last_synced_at = ?
                  WHERE id = ?
                `;

                await this.db.run(sql, [
                  resolvedTask.title,
                  resolvedTask.description || null,
                  resolvedTask.completed ? 1 : 0,
                  resolvedTask.updated_at instanceof Date ? resolvedTask.updated_at.toISOString() : resolvedTask.updated_at,
                  'synced',
                  processedItem.server_id || null,
                  new Date().toISOString(),
                  resolvedTask.id
                ]);

                await this.db.run('DELETE FROM sync_queue WHERE id = ?', [queueItem.id]);
                result.synced_items++;
                console.log(`Successfully resolved conflict for item: ${queueItem.id}, count: ${result.synced_items}`);
              }
            } else {
              const error = new Error(processedItem.error || 'Unknown error');
              await this.handleSyncError(queueItem, error);
              result.failed_items++;
              result.errors.push({
                task_id: queueItem.task_id,
                operation: queueItem.operation,
                error: processedItem.error || 'Unknown error',
                timestamp: new Date()
              });
              console.log(`Failed to sync item: ${queueItem.id}, error: ${processedItem.error}`);
            }
          }
        } catch (batchError) {
          console.log(`Batch error:`, batchError);
          for (const item of batch) {
            await this.handleSyncError(item, batchError as Error);
            result.failed_items++;
            result.errors.push({
              task_id: item.task_id,
              operation: item.operation,
              error: (batchError as Error).message,
              timestamp: new Date()
            });
          }
        }
      }

      result.success = result.failed_items === 0;
      console.log(`Final sync result:`, result);
      return result;

    } catch (error) {
      console.error('Sync failed:', error);
      result.success = false;
      return result;
    }
  }

  async addToSyncQueue(taskId: string, operation: 'create' | 'update' | 'delete', data: Partial<Task>): Promise<void> {
    const queueItem: SyncQueueItem = {
      id: uuidv4(),
      task_id: taskId,
      operation,
      data,
      created_at: new Date(),
      retry_count: 0
    };

    const sql = `
      INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      queueItem.id,
      queueItem.task_id,
      queueItem.operation,
      JSON.stringify(queueItem.data),
      queueItem.created_at.toISOString(),
      queueItem.retry_count
    ]);
  }

  private async getSyncQueueItems(): Promise<SyncQueueItem[]> {
    const sql = `
      SELECT * FROM sync_queue 
      WHERE retry_count < ?
      ORDER BY created_at ASC
    `;
    
    const rows = await this.db.all(sql, [this.MAX_RETRY_COUNT]);
    
    return rows.map(row => ({
      id: row.id,
      task_id: row.task_id,
      operation: row.operation,
      data: JSON.parse(row.data),
      created_at: new Date(row.created_at),
      retry_count: row.retry_count,
      error_message: row.error_message
    }));
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const batchRequest: BatchSyncRequest = {
      items,
      client_timestamp: new Date()
    };

    try {
      const response = await axios.post<BatchSyncResponse>(
        `${this.apiUrl}/sync/batch`,
        batchRequest,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Batch sync failed: ${error.message}`);
      }
      throw error;
    }
  }

  private async resolveConflict(localTask: Task, serverTask: Task): Promise<Task> {
    const localTimestamp = new Date(localTask.updated_at).getTime();
    const serverTimestamp = new Date(serverTask.updated_at).getTime();

    const winner = localTimestamp > serverTimestamp ? localTask : serverTask;
    
    console.log(`Conflict resolved for task ${localTask.id}: ${winner === localTask ? 'local' : 'server'} version wins`);
    
    return winner;
  }

  private async updateSyncStatus(queueItemId: string, taskId: string, status: 'synced' | 'error', serverData?: Partial<Task>): Promise<void> {
    const updates: string[] = ['sync_status = ?', 'last_synced_at = ?'];
    const params: any[] = [status, new Date().toISOString()];

    if (serverData?.server_id) {
      updates.push('server_id = ?');
      params.push(serverData.server_id);
    }

    params.push(taskId);

    const sql = `
      UPDATE tasks 
      SET ${updates.join(', ')}
      WHERE id = ?
    `;

    await this.db.run(sql, params);

    if (status === 'synced') {
      await this.db.run('DELETE FROM sync_queue WHERE id = ?', [queueItemId]);
    }
  }

  private async handleSyncError(item: SyncQueueItem, error: Error): Promise<void> {
    const newRetryCount = item.retry_count + 1;
    
    if (newRetryCount >= this.MAX_RETRY_COUNT) {
      console.error(`Task ${item.task_id} exceeded max retry count. Marking as permanent failure.`);
      
      const sql = `
        UPDATE tasks 
        SET sync_status = ?
        WHERE id = ?
      `;
      await this.db.run(sql, ['error', item.task_id]);
      
      await this.db.run('DELETE FROM sync_queue WHERE id = ?', [item.id]);
    } else {
      const sql = `
        UPDATE sync_queue 
        SET retry_count = ?, error_message = ?
        WHERE id = ?
      `;
      await this.db.run(sql, [newRetryCount, error.message, item.id]);
    }
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      await axios.get(`${this.apiUrl}/health`, { 
        timeout: this.HEALTH_CHECK_TIMEOUT 
      });
      return true;
    } catch {
      return false;
    }
  }
}