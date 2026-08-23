import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the product monogram with the presentation requested by its host
 * surface. Ink rides currentColor so both themes stay legible without a
 * dedicated stylesheet; layout-only inline styles carry no literal colors.
 * @param props - Host-supplied mark presentation.
 * @returns the dph monogram.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-block', fontSize: size, fontWeight: 700, lineHeight: 1, letterSpacing: '0.02em' }}
      aria-hidden="true"
    >
      dph
    </span>
  )
}

/**
 * Render the product name where the host surface requests the brand name.
 * @returns the product wordmark text.
 */
export function OfficialBrandName() {
  return (
    <span style={{ fontWeight: 700, letterSpacing: '0.02em' }} aria-hidden="true">
      dph
    </span>
  )
}
