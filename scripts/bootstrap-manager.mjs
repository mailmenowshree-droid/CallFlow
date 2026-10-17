import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const email = process.env.BOOTSTRAP_MANAGER_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_MANAGER_PASSWORD;
const name = process.env.BOOTSTRAP_MANAGER_NAME?.trim() || "CallFlow Manager";
const databaseName = process.env.MONGODB_DB || "callflow";

if (!uri || !email || !password) {
  console.error("Set MONGODB_URI, BOOTSTRAP_MANAGER_EMAIL, and BOOTSTRAP_MANAGER_PASSWORD in your local environment.");
  process.exit(1);
}
if (password.length < 14) {
  console.error("Bootstrap password must be at least 14 characters.");
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
try {
  await client.connect();
  const users = client.db(databaseName).collection("users");
  const existing = await users.findOne({ email });
  if (existing) {
    console.error("A user with that email already exists; refusing to overwrite it.");
    process.exitCode = 1;
  } else {
    await users.insertOne({
      id: crypto.randomUUID(),
      email,
      name,
      role: "Manager",
      active: true,
      passwordHash: await hash(password, 12),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log("Manager account created. Remove the bootstrap environment variables now.");
  }
} finally {
  await client.close();
}
