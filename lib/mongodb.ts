import { Db, MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB ?? "callflow";

declare global {
  // eslint-disable-next-line no-var
  var callFlowMongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

export function getMongoClient(): Promise<MongoClient> {
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
  const client = await getMongoClient();
  return client.db(databaseName);
}

/** Idempotent indexes for the first persistence milestone. */
let indexesPromise: Promise<void> | undefined;

export async function ensureCallFlowIndexes(): Promise<void> {
  indexesPromise ??= (async () => {
    const db = await getDatabase();
    await Promise.all([
      db.collection("engineers").createIndex({ email: 1 }, { unique: true, sparse: true }),
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("assignments").createIndex({ requestId: 1 }, { unique: true, sparse: true }),
      db.collection("assignments").createIndex({ rotation: 1, status: 1, scheduledStartAt: 1 }),
      db.collection("rotation_state").createIndex({ _id: 1 }, { unique: true }),
      db.collection("audit_events").createIndex({ occurredAt: -1 }),
      db.collection("wfh_quota").createIndex({ engineerId: 1, quarterStart: 1 }, { unique: true }),
      db.collection("attendance_events").createIndex(
        { engineerId: 1, attendanceDate: 1, eventType: 1 },
        { unique: true, partialFilterExpression: { eventType: "WFH_CHECKED_IN" } },
      ),
      db.collection("login_rate_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  })();
  try {
    await indexesPromise;
  } catch (error) {
    indexesPromise = undefined;
    throw error;
  }
}
