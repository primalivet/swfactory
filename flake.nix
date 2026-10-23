{
  description = "swfactory: learning software factories by building one";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            pkgs.vscode-langservers-extracted
            pkgs.typescript-language-server
            nodejs_24
            pnpm
            gh
            git
            jq
          ];
        };
      });
}
