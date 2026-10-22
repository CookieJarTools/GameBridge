using System;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// What GameBridge worked out from an Unreal material: which texture plays which part, and the
	/// few values worth carrying across. A channel of -1 means there is no texture for that part.
	/// </summary>
	[Serializable]
	public sealed class GameBridgeMaterialSpec
	{
		public string name;
		public string path;
		public string blend;
		public bool twoSided;
		public float cutoff;
		public string baseMap;
		public string normalMap;
		public string emissionMap;
		public string metallicMap;
		public int metallicChannel;
		public string occlusionMap;
		public int occlusionChannel;
		public string roughnessMap;
		public int roughnessChannel;
		public float[] tint;
		public float metallic;
		public float roughness;
		public float emission;
	}
}
