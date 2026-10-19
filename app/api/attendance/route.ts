import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRecord } from "@/lib/callflow-types";
import { reserveWfhDay } from "@/lib/wfh-quota";
