import type { SpriteFamilyRule } from '../config/spriteConfig'
import { SPRITE_ASSET_DEFINITIONS } from '../config/spriteAssets'

export interface SpriteAssetVariant {
  textureUrl: string
  scaleMultiplier: number
}

export interface SpriteRegistry {
  byFamilyId: Map<string, SpriteAssetVariant[]>
}

function buildVariant(definition: {
  familyFolder: string
  fileName: string
  scaleMultiplier?: number
}): SpriteAssetVariant {
  return {
    textureUrl: new URL(
      `../assets/sprites/${definition.familyFolder}/${definition.fileName}`,
      import.meta.url,
    ).href,
    scaleMultiplier: definition.scaleMultiplier ?? 1,
  }
}

export function createSpriteRegistry(families: SpriteFamilyRule[]): SpriteRegistry {
  const variantsByFolder = new Map<string, SpriteAssetVariant[]>()

  SPRITE_ASSET_DEFINITIONS.forEach((definition) => {
    const variant = buildVariant(definition)
    const existing = variantsByFolder.get(definition.familyFolder)
    if (existing) {
      existing.push(variant)
      return
    }

    variantsByFolder.set(definition.familyFolder, [variant])
  })

  const byFamilyId = new Map<string, SpriteAssetVariant[]>()

  families.forEach((family) => {
    const variants = variantsByFolder.get(family.folder) ?? []
    byFamilyId.set(family.id, [...variants])
  })

  return { byFamilyId }
}
