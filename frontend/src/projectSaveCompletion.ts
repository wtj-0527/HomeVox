export type ProjectSaveIntent = {
  stage: 'snapshot' | 'final'
  canonicalRevision: string | null
}

/** A save response can complete Step 6 only when it originated there and still
 * refers to the same canonical revision. */
export function completesFinalSave(
  activeStep: number,
  canonicalRevision: string | null,
  intent: ProjectSaveIntent,
): boolean {
  return intent.stage === 'final' && activeStep === 6 && intent.canonicalRevision !== null && intent.canonicalRevision === canonicalRevision
}
