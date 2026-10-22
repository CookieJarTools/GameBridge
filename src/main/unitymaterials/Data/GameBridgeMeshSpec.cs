using System;

namespace GameBridgeGenerated.Materials
{
	/// <summary>A transferred model and the material each of its slots should use.</summary>
	[Serializable]
	public sealed class GameBridgeMeshSpec
	{
		public string path;
		public GameBridgeSlotSpec[] slots;
	}
}
