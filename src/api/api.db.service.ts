import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      user: 'root',
      host: 'localhost',
      database: 'interchain_db',
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
          hash TEXT NOT NULL UNIQUE,
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
  async findTransactionByHash(hash: string): Promise<any | null> {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT *
        FROM transactions
        WHERE hash = $1
      `;
      const values = [hash];
      const result = await client.query(query, values);
  
      if (result.rows.length > 0) {
        console.log('Transaction found:', result.rows[0]);
        return result.rows[0]; // 첫 번째 매칭 결과 반환
      } else {
        console.log(`No transaction found for hash: ${hash}`);
        return null; // 결과 없음
      }
    } catch (err) {
      console.error('Error finding transaction by hash:', err);
      throw err;
    } finally {
      client.release();
    }
  }
  
  async saveTransaction(data: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      const hash = data.txHash || data.hash;
      // hash 값 유효성 검사
    if (!hash) {
        throw new Error('Hash value is missing. Cannot save transaction.');
    }
  
    const query = `
    INSERT INTO transactions (hash, contents, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (hash) DO NOTHING
    `;

    const values = [hash, JSON.stringify(data.contents || data)];
    await client.query(query, values);

    console.log('Transaction saved successfully:', hash);
    } catch (err) {
        console.error('Error saving data to PostgreSQL:', err);
        throw err;
    } finally {
        client.release();
    }
  }
}
