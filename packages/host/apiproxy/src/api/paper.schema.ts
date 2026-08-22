/**
 * paper domain zod schemas. Request-side validation only: run and event
 * views are projections of durable validated records assembled host-side.
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { RequestPayload, ResponseValue } from './index.ts'

/** paper.runs.list request payload. */
export const paperRunsListRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.list'>>>

/** paper.runs.list response value. */
export const paperRunsListValueSchema = z.object({
  runs: z.array(z.object({ id: z.string() })),
}) as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.list'>>>

/** paper.runs.get request payload. */
export const paperRunGetRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.get'>>>

/** paper.runs.get response value. */
export const paperRunGetValueSchema = z.object({
  run: z.object({ id: z.string(), lastEventSeq: z.number() }),
}) as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.get'>>>

/** paper.runs.start request payload. */
export const paperRunStartRequestSchema = z.object({
  mode: z.enum(['fast', 'strict']),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.start'>>>

/** paper.runs.start response value. */
export const paperRunStartValueSchema = paperRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.start'>>>

/** paper.runs.pause request payload. */
export const paperRunPauseRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.pause'>>>

/** paper.runs.pause response value. */
export const paperRunPauseValueSchema = paperRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.pause'>>>

/** paper.runs.resume request payload. */
export const paperRunResumeRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.resume'>>>

/** paper.runs.resume response value. */
export const paperRunResumeValueSchema = paperRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.resume'>>>

/** paper.runs.cancel request payload. */
export const paperRunCancelRequestSchema = z.object({
  runId: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.cancel'>>>

/** paper.runs.cancel response value. */
export const paperRunCancelValueSchema = paperRunGetValueSchema as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.cancel'>>>

/** paper.runs.events request payload. */
export const paperRunEventsRequestSchema = z.object({
  runId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.runs.events'>>>

/** paper.runs.events response value. */
export const paperRunEventsValueSchema = z.object({
  events: z.array(z.object({ seq: z.number(), type: z.string() })),
  lastSeq: z.number(),
}) as unknown as z.ZodType<Wire<ResponseValue<'paper.runs.events'>>>

/** paper.skills.list request payload. */
export const paperSkillsListRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'paper.skills.list'>>>

/** paper.skills.list response value. */
export const paperSkillsListValueSchema = z.object({
  skills: z.array(z.object({ id: z.string(), installedVersion: z.string() })),
}) as unknown as z.ZodType<Wire<ResponseValue<'paper.skills.list'>>>

/** paper.skills.install request payload. */
export const paperSkillInstallRequestSchema = z.object({
  directory: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.skills.install'>>>

/** paper.skills.install response value. */
export const paperSkillInstallValueSchema = z.object({
  skill: z.object({ id: z.string(), installedVersion: z.string() }),
}) as unknown as z.ZodType<Wire<ResponseValue<'paper.skills.install'>>>

/** paper.skills.rollback request payload. */
export const paperSkillRollbackRequestSchema = z.object({
  id: z.string().min(1),
  toVersion: z.string().min(1),
}) as unknown as z.ZodType<Wire<RequestPayload<'paper.skills.rollback'>>>

/** paper.skills.rollback response value. */
export const paperSkillRollbackValueSchema = paperSkillInstallValueSchema as unknown as z.ZodType<Wire<ResponseValue<'paper.skills.rollback'>>>
