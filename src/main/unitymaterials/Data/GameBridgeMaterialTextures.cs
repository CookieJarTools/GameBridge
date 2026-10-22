using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// The textures a material ends up with in Unity. The mask holds metallic in red, occlusion in
	/// green and smoothness in alpha, which is the layout URP, HDRP and the Standard shader all read.
	/// </summary>
	public sealed class GameBridgeMaterialTextures
	{
		public Texture2D BaseMap { get; set; }
		public Texture2D NormalMap { get; set; }
		public Texture2D MaskMap { get; set; }
		public Texture2D EmissionMap { get; set; }
	}
}
