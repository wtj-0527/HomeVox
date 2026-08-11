import { useCallback, useRef, useState } from 'react'
import {
  transitionProductFlow,
  type ProductFlowContext,
  type ProductFlowEvent,
  type ProductFlowState,
  type ProductStep,
} from './productFlow'

export type ProductFlowController = ProductFlowState & {
  transition: (event: ProductFlowEvent, context: Omit<ProductFlowContext, 'completed'>) => void
}

/** Stateful boundary for every product-step transition.  UI components only
 * receive this typed transition function; they cannot mutate step state. */
export function useProductFlowController(initial: ProductFlowState = { activeStep: 1, completed: [] }): ProductFlowController {
  const [state, setState] = useState<ProductFlowState>(initial)
  const stateRef = useRef(state)
  const transition = useCallback((event: ProductFlowEvent, context: Omit<ProductFlowContext, 'completed'>) => {
    const next = transitionProductFlow(stateRef.current, event, context)
    stateRef.current = next
    setState(next)
  }, [])
  return {
    activeStep: state.activeStep as ProductStep,
    completed: state.completed,
    transition,
  }
}
