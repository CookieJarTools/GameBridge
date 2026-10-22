using System;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// One material slot. The name is the material name inside the FBX, which Unreal sets to the
	/// material asset's name, and the material is the path of the material to put there.
	/// </summary>
	[Serializable]
	public sealed class GameBridgeSlotSpec
	{
		public string name;
		public string material;
	}
}
