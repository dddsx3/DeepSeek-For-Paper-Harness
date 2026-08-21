/**
 * harness domain zod schemas. Request-side validation only: run and event
 * views are projections of durable validated records assembled host-side.
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { RequestPayload, ResponseValue } from './index.ts'

/** harness.runs.list request payload. */
export const harnessRunsListRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.list'>>>

/** harness.runs.list response value. */
export const harnessRunsListValueSchema = z.object({
  runs: z.array(z.object({ id: z.string() })),
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.list'>>>

/** harness.runs.get request payload. */
export const harnessRunGetRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.get'>>>

/** harness.runs.get response value. */
export const harnessRunGetValueSchema = z.object({
  run: z.object({ id: z.string(), lastEventSeq: z.number() }),
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.get'>>>

/** harness.runs.start request payload. */
export const harnessRunStartRequestSchema = z.object({
  mode: z.enum(['fast', 'strict']),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.start'>>>

/** harness.runs.start response value. */
export const harnessRunStartValueSchema = harnessRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.start'>>>

/** harness.runs.pause request payload. */
export const harnessRunPauseRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.pause'>>>

/** harness.runs.pause response value. */
export const harnessRunPauseValueSchema = harnessRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.pause'>>>

/** harness.runs.resume request payload. */
export const harnessRunResumeRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.resume'>>>

/** harness.runs.resume response value. */
export const harnessRunResumeValueSchema = harnessRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.resume'>>>

/** harness.runs.cancel request payload. */
export const harnessRunCancelRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.cancel'>>>

/** harness.runs.cancel response value. */
export const harnessRunCancelValueSchema = harnessRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.cancel'>>>

/** harness.runs.events request payload. */
export const harnessRunEventsRequestSchema = z.object({
  runId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.runs.events'>>>

/** harness.runs.events response value. */
export const harnessRunEventsValueSchema = z.object({
  events: z.array(z.object({ seq: z.number(), type: z.string() })),
  lastSeq: z.number(),
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.runs.events'>>>

/** harness.skills.list request payload. */
export const harnessSkillsListRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'harness.skills.list'>>>

/** harness.skills.list response value. */
export const harnessSkillsListValueSchema = z.object({
  skills: z.array(z.object({ id: z.string(), installedVersion: z.string() })),
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.skills.list'>>>

/** harness.skills.install request payload. */
export const harnessSkillInstallRequestSchema = z.object({
  directory: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.skills.install'>>>

/** harness.skills.install response value. */
export const harnessSkillInstallValueSchema = z.object({
  skill: z.object({ id: z.string(), installedVersion: z.string() }),
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.skills.install'>>>

/** harness.skills.rollback request payload. */
export const harnessSkillRollbackRequestSchema = z.object({
  id: z.string().min(1),
  toVersion: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'harness.skills.rollback'>>>

/** harness.skills.rollback response value. */
export const harnessSkillRollbackValueSchema = harnessSkillInstallValueSchema as unknown as z.ZodType<Wire<ResponseValue<'harness.skills.rollback'>>>
