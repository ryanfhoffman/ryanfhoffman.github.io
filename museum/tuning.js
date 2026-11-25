// THE HOFFMAN MUSEUM: THE FEEL TABLE
//
// Every number that shapes how the museum feels to move through lives in this file.
// Change a number, reload the page, and play. Nothing else needs editing.
// Distances are metres, times are seconds, speeds are metres per second, angles are degrees.

// ---- Walking and sprinting ----
export const walkSpeed = 4.5 // m/s: steady speed with W, A, S, or D held
export const sprintSpeed = 7.5 // m/s: steady speed with Shift also held
export const groundAcceleration = 30 // m/s²: how fast speed builds, turns, and stops on the floor
export const airAcceleration = 12 // m/s²: how strongly the keys steer in mid-air

// ---- Jumping ----
export const gravity = 20 // m/s²: pull toward the floor; higher feels snappier
export const jumpHeight = 1.1 // m: rise of one jump; the double jump adds the same again
export const jumpLimit = 2 // accepted impulses between landings

// ---- Crouching and sliding ----
export const slideStartSpeed = 3.5 // m/s: incoming grounded speed required for a C press to slide
export const crouchSpeed = 2 // m/s: walking with C held below the slide threshold
export const slideBurst = 3.5 // m/s: speed added the moment a slide starts
export const slideTopSpeed = 11 // m/s: the burst never lifts speed above this
export const slideFriction = 5 // m/s²: how fast a slide loses speed
export const slideEndSpeed = 3 // m/s: the slide ends once it is slower than this

// ---- The body ----
export const eyeHeight = 1.6 // m: viewpoint above the feet, standing (the floor plan assumes 1.6)
export const slideEyeHeight = 0.7 // m: viewpoint above the feet when crouching or sliding
export const eyeSpeed = 5 // m/s: how fast the viewpoint drops into a slide and rises out of it
export const stepHeight = 0.22 // m: largest walkable stair riser
export const bodyRadius = 0.3 // m: how close the body's centre can get to a wall
export const bodyHeight = 1.8 // m: feet to top of head; the head stops at the ceiling

// ---- View widths (used by the engine, not by the movement code) ----
export const pageFov = 28 // degrees, vertical: the flat page, before the reveal and while focused
export const museumFov = 66 // degrees, vertical: walking around the museum
export const sprintFovExtra = 8 // degrees: added to museumFov while sprinting
export const fovWidenTime = 0.82 // s: ease out of the flat page on entry or departure
export const focusTime = 0.5 // s: glide in to read a wall page
export const sprintFovTime = 0.5 // s: add or remove the full sprint widening
export const mouseSensitivity = 0.12 // degrees of yaw or pitch per pixel of mouse travel
export const pitchLimit = 90 // degrees: maximum mouse look above or below the horizon
