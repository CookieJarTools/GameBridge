/** Vite inlines files imported with ?raw as strings (used for the Unreal export script). */
declare module '*?raw' {
  const content: string
  export default content
}
