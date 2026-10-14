import type { EngineKind } from './types'

const UNITY_GITIGNORE = `# Unity
/[Ll]ibrary/
/[Tt]emp/
/[Oo]bj/
/[Bb]uild/
/[Bb]uilds/
/[Ll]ogs/
/[Uu]ser[Ss]ettings/
/[Mm]emoryCaptures/
/[Rr]ecordings/
.vs/
.vsconfig
.gradle/
ExportedObj/
*.csproj
*.unityproj
*.sln
*.suo
*.tmp
*.user
*.userprefs
*.pidb
*.booproj
*.svd
*.pdb
*.mdb
*.opendb
*.VC.db
*.apk
*.aab
*.unitypackage
*.app
crashlytics-build.properties
sysinfo.txt
`

const UNREAL_GITIGNORE = `# Unreal Engine
Binaries/
DerivedDataCache/
Intermediate/
Saved/
.vscode/
.vs/
*.VC.db
*.opensdf
*.opendb
*.sdf
*.sln
*.suo
*.xcodeproj
*.xcworkspace
`

const GENERIC_GITIGNORE = `# Build output
/bin/
/build/
/Build/
/obj/
/out/
/dist/

# Editor / OS
.vs/
.vscode/
.idea/
.DS_Store
Thumbs.db
*.user
*.log
`

/** A .gitattributes with sensible Git LFS tracking for game binary assets. */
export const GITATTRIBUTES_LFS = `# Normalize line endings
* text=auto

# Git LFS — binary assets
*.psd  filter=lfs diff=lfs merge=lfs -text
*.png  filter=lfs diff=lfs merge=lfs -text
*.jpg  filter=lfs diff=lfs merge=lfs -text
*.jpeg filter=lfs diff=lfs merge=lfs -text
*.tga  filter=lfs diff=lfs merge=lfs -text
*.tif  filter=lfs diff=lfs merge=lfs -text
*.tiff filter=lfs diff=lfs merge=lfs -text
*.exr  filter=lfs diff=lfs merge=lfs -text
*.hdr  filter=lfs diff=lfs merge=lfs -text
*.fbx  filter=lfs diff=lfs merge=lfs -text
*.obj  filter=lfs diff=lfs merge=lfs -text
*.blend filter=lfs diff=lfs merge=lfs -text
*.wav  filter=lfs diff=lfs merge=lfs -text
*.mp3  filter=lfs diff=lfs merge=lfs -text
*.ogg  filter=lfs diff=lfs merge=lfs -text
*.mp4  filter=lfs diff=lfs merge=lfs -text
*.mov  filter=lfs diff=lfs merge=lfs -text
*.ttf  filter=lfs diff=lfs merge=lfs -text
*.otf  filter=lfs diff=lfs merge=lfs -text
`

export function gitignoreFor(kind: EngineKind): string {
  if (kind === 'unity') return UNITY_GITIGNORE
  if (kind === 'unreal') return UNREAL_GITIGNORE
  return GENERIC_GITIGNORE
}
