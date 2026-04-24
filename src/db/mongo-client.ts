import { MongoClient, type Db, type Collection, type Document, type IndexDescription } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;
let indexesReady = false;

function getMongoUri(): string {
  return process.env.MONGODB_URI || 'mongodb://localhost:27018';
}

function getMongoDbName(): string {
  return process.env.MONGODB_DB || 'novalogic_knowledge';
}

async function ensureIndexes(database: Db): Promise<void> {
  if (indexesReady) return;

  const collection = database.collection('business_processes');
  const indexes: IndexDescription[] = [
    { key: { slug: 1 }, unique: true, name: 'business_process_slug_unique' },
    { key: { domain: 1, status: 1 }, name: 'business_process_domain_status' },
    { key: { tags: 1 }, name: 'business_process_tags' },
    { key: { updated_at: -1 }, name: 'business_process_updated_at' },
  ];

  for (const index of indexes) {
    await collection.createIndex(index.key, index);
  }

  indexesReady = true;
}

export async function initMongo(): Promise<void> {
  if (!client) {
    client = new MongoClient(getMongoUri(), { maxPoolSize: 10 });
    await client.connect();
  }

  if (!db) {
    db = client.db(getMongoDbName());
  }

  await ensureIndexes(db);
}

export async function getMongoDb(): Promise<Db> {
  await initMongo();
  if (!db) {
    throw new Error('MongoDB not initialized');
  }
  return db;
}

export async function getMongoCollection<TSchema extends Document = Document>(
  name: string,
): Promise<Collection<TSchema>> {
  const database = await getMongoDb();
  return database.collection<TSchema>(name);
}

export async function shutdownMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    indexesReady = false;
  }
}
