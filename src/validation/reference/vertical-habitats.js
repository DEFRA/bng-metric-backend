/**
 * The habitats the Statutory Metric counts by their vertical area, which the
 * BNG Service template records on its Vertical Area Habitats layers (its
 * `CSV References/Vertical Area Habitats/` lists): the two green walls and
 * the three intertidal hard structures. They are area habitats in every other
 * respect, scored on the Metric's area habitat sheets, and left out of the
 * site area.
 */
const URBAN = 'Urban'
const INTERTIDAL_HARD_STRUCTURES = 'Intertidal hard structures'

export const VERTICAL_HABITATS = Object.freeze([
  Object.freeze({
    broadHabitat: URBAN,
    habitatType: 'Facade-bound green wall'
  }),
  Object.freeze({
    broadHabitat: URBAN,
    habitatType: 'Ground based green wall'
  }),
  Object.freeze({
    broadHabitat: INTERTIDAL_HARD_STRUCTURES,
    habitatType: 'Artificial hard structures'
  }),
  Object.freeze({
    broadHabitat: INTERTIDAL_HARD_STRUCTURES,
    habitatType: 'Artificial features of hard structures'
  }),
  Object.freeze({
    broadHabitat: INTERTIDAL_HARD_STRUCTURES,
    habitatType:
      'Artificial hard structures with integrated greening of grey infrastructure (IGGI)'
  })
])

/** The broad habitats a vertical area habitat may have. */
export const VERTICAL_BROAD_HABITATS = Object.freeze([
  ...new Set(VERTICAL_HABITATS.map((habitat) => habitat.broadHabitat))
])

/**
 * Every name a vertical area habitat's type may be stored under: the type the
 * template's drop-down offers, and the Metric's "<broad> - <type>" label.
 */
export const VERTICAL_HABITAT_TYPE_NAMES = Object.freeze(
  VERTICAL_HABITATS.flatMap(({ broadHabitat, habitatType }) => [
    habitatType,
    `${broadHabitat} - ${habitatType}`
  ])
)

/**
 * Whether a broad habitat and habitat type name a vertical area habitat.
 *
 * @param {unknown} broadType
 * @param {unknown} type
 * @returns {boolean}
 */
export function isVerticalHabitat(broadType, type) {
  return VERTICAL_HABITATS.some(
    ({ broadHabitat, habitatType }) =>
      broadHabitat === broadType &&
      (habitatType === type || `${broadHabitat} - ${habitatType}` === type)
  )
}
