using UnityEngine;
using UnityEngine.Rendering;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Works out which render pipeline the project uses. The pipeline asset is looked at by type name,
	/// so this compiles in projects that have neither URP nor HDRP installed.
	/// </summary>
	public static class GameBridgePipelines
	{
		public static GameBridgePipeline Current()
		{
			var asset = GraphicsSettings.currentRenderPipeline;
			if (asset == null)
			{
				return GameBridgePipeline.BuiltIn;
			}

			var type = asset.GetType().FullName ?? string.Empty;
			if (type.Contains("HighDefinition"))
			{
				return GameBridgePipeline.HighDefinition;
			}

			return type.Contains("Universal") ? GameBridgePipeline.Universal : GameBridgePipeline.BuiltIn;
		}

		public static Shader LitShader(GameBridgePipeline pipeline)
		{
			switch (pipeline)
			{
				case GameBridgePipeline.Universal:
					return Shader.Find("Universal Render Pipeline/Lit");
				case GameBridgePipeline.HighDefinition:
					return Shader.Find("HDRP/Lit");
				default:
					return Shader.Find("Standard");
			}
		}
	}
}
