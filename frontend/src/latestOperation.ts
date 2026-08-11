export type OperationToken = { isCurrent: () => boolean }

export class LatestOperation {
  private generation = 0

  begin(): OperationToken {
    const generation = ++this.generation
    return { isCurrent: () => generation === this.generation }
  }

  invalidate(): void {
    this.generation += 1
  }
}