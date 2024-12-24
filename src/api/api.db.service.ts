import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      user: 'root',
      host: 'localhost',
      database: 'postgres',
      password: '1234',
      port: '5432',
    });

    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // 데이터베이스가 없으면 생성
      const dbQuery = `
        SELECT 1 FROM pg_database WHERE datname = 'interchain_db';
      `;
      const dbCheck = await client.query(dbQuery);

      if (dbCheck.rows.length === 0) {
        await client.query(`CREATE DATABASE interchain_db;`);
        console.log("Database 'interchain_db' created successfully.");
      }

      // 테이블 생성
      const tableQuery = `
        CREATE TABLE IF NOT EXISTS transactions (
          id SERIAL PRIMARY KEY,
          contents JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await client.query(tableQuery);
      console.log("Table 'transactions' ensured to exist.");
    } catch (err) {
      console.error("Error initializing database or table:", err);
      throw err;
    } finally {
      client.release(); // 연결 해제
    }
  }

  async saveTransaction(data: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO transactions (contents, created_at)
        VALUES ($1, NOW())
      `;
      const values = [JSON.stringify(data.contents || data)];
      await client.query(query, values);
      console.log('Transaction saved successfully:', data.contents || data);
    } catch (err) {
      console.error('Error saving data to PostgreSQL:', err);
      throw err;
    } finally {
      client.release();
    }
  }
}
