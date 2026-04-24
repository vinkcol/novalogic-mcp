import type { Filter } from 'mongodb';
import { getMongoCollection } from '../db/mongo-client.js';

export interface BusinessProcessStep {
  name?: string;
  title?: string;
  owner?: string;
  description?: string;
  inputs?: string[];
  outputs?: string[];
  systems?: string[];
  decisions?: string[];
  [key: string]: any;
}

export interface BusinessProcessDocument {
  slug: string;
  name: string;
  domain: string;
  description?: string;
  goal?: string;
  trigger?: string;
  status: string;
  actors: string[];
  systems: string[];
  inputs: string[];
  outputs: string[];
  steps: BusinessProcessStep[];
  business_rules: string[];
  kpis: string[];
  tags: string[];
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

interface UpsertBusinessProcessInput {
  slug: string;
  name: string;
  domain: string;
  description?: string;
  goal?: string;
  trigger?: string;
  status?: string;
  actors?: string[];
  systems?: string[];
  inputs?: string[];
  outputs?: string[];
  steps?: BusinessProcessStep[];
  business_rules?: string[];
  kpis?: string[];
  tags?: string[];
  metadata?: Record<string, any>;
}

interface ListBusinessProcessesOptions {
  domain?: string;
  status?: string;
  tag?: string;
  limit?: number;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSteps(value: unknown): BusinessProcessStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is BusinessProcessStep | string => typeof item === 'string' || (!!item && typeof item === 'object'))
    .map((item) => {
      if (typeof item === 'string') {
        return { name: item };
      }
      return item;
    });
}

export async function upsertBusinessProcess(
  input: UpsertBusinessProcessInput,
): Promise<BusinessProcessDocument> {
  const collection = await getMongoCollection<BusinessProcessDocument>('business_processes');
  const now = new Date();

  await collection.updateOne(
    { slug: input.slug },
    {
      $set: {
        name: input.name,
        domain: input.domain,
        description: input.description,
        goal: input.goal,
        trigger: input.trigger,
        status: input.status || 'draft',
        actors: normalizeStringList(input.actors),
        systems: normalizeStringList(input.systems),
        inputs: normalizeStringList(input.inputs),
        outputs: normalizeStringList(input.outputs),
        steps: normalizeSteps(input.steps),
        business_rules: normalizeStringList(input.business_rules),
        kpis: normalizeStringList(input.kpis),
        tags: normalizeStringList(input.tags),
        metadata: input.metadata || {},
        updated_at: now,
      },
      $setOnInsert: {
        slug: input.slug,
        created_at: now,
      },
    },
    { upsert: true },
  );

  const saved = await collection.findOne({ slug: input.slug }, { projection: { _id: 0 } });
  if (!saved) {
    throw new Error(`Failed to load process after upsert: ${input.slug}`);
  }

  return saved;
}

export async function getBusinessProcess(
  slug: string,
): Promise<BusinessProcessDocument | null> {
  const collection = await getMongoCollection<BusinessProcessDocument>('business_processes');
  return collection.findOne({ slug }, { projection: { _id: 0 } });
}

export async function listBusinessProcesses(
  options: ListBusinessProcessesOptions = {},
): Promise<BusinessProcessDocument[]> {
  const collection = await getMongoCollection<BusinessProcessDocument>('business_processes');
  const filter: Filter<BusinessProcessDocument> = {};

  if (options.domain) filter.domain = options.domain;
  if (options.status) filter.status = options.status;
  if (options.tag) filter.tags = options.tag;

  return collection
    .find(filter, {
      projection: { _id: 0 },
      sort: { updated_at: -1 },
      limit: options.limit || 50,
    })
    .toArray();
}
