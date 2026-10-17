import { Db, MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB ?? "callflow";

if (process.env.NODE_ENV === "production" && !uri) {
  // Fail closed when a production deployment has not been configured.
  // The connection is only created when a server API explicitly requests it.
}

declare global {
  // eslint-disable-next-line no-var
  var callFlowMongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

function getClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (process.env.NODE_ENV === "development") {
    global.callFlowMongoClientPromise ??= new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    }).connect();
    return global.callFlowMongoClientPromise;
  }
  clientPromise ??= new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  }).connect();
  return clientPromise;
}

export async function getDatabase(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(databaseName);
}

/** Idempotent indexes for the first persistence milestone. */
export async function ensureCallFlowIndexes(): Promise<void> {
  const db = await getDatabase();
  await Promise.all([
    db.collection("engineers").createIndex({ email: 1 }, { unique: true, sparse: true }),
    db.collection("assignments").createIndex({ requestId: 1 }, { unique: true, sparse: true }),
    db.collection("assignments").createIndex({ rotation: 1, status: 1, scheduledStartAt: 1 }),
    db.collection("rotation_state").createIndex({ _id: 1 }, { unique: true }),
    db.collection("audit_events").createIndex({ occurredAt: -1 }),
  ]);
}
