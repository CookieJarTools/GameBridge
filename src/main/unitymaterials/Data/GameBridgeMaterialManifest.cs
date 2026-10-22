using System;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// One transfer's worth of materials to build, written by GameBridge next to this script. The
	/// paths inside are relative to the root folder the transfer went into.
	/// </summary>
	[Serializable]
	public sealed class GameBridgeMaterialManifest
	{
		public string root;
		public GameBridgeMaterialSpec[] materials;
		public GameBridgeMeshSpec[] meshes;
	}
}
