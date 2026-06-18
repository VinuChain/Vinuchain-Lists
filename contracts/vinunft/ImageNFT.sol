// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;

import {Base64} from "./MetadataUtils.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import {StringUtils} from "./StringUtils.sol";

contract ImageNFT is
    ERC1155Supply,
    ERC2981
{
    uint256 public lastTokenId;
    mapping(uint256 => address) private _authors;

    mapping(uint256 => string) private uris;

    constructor() ERC1155("") { }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC1155, ERC2981)
        returns (bool)
    {
        return ERC1155.supportsInterface(interfaceId) || ERC2981.supportsInterface(interfaceId) || super.supportsInterface(interfaceId);
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        require(exists(tokenId), "ImageNFT: uri query for nonexistent token");
        return uris[tokenId];
    }

    function mint(
        string memory _uri,
        uint256 amount_,
        uint96 royaltyNumerator_, //NB: two decimals, so 10% is 1000
        address royaltyRecipient_,
        bytes memory data_
    ) external returns (uint256) {
        require(amount_ > 0, "ImageNFT: amount cannot be zero");
        lastTokenId++;

        uint256 newTokenId = lastTokenId;
        uris[newTokenId] = _uri;
        _setTokenRoyalty(newTokenId, royaltyRecipient_, royaltyNumerator_);

        _mint(msg.sender, newTokenId, amount_, data_);
        _authors[newTokenId] = msg.sender;

        return newTokenId;
    }

    function authorOf(uint256 tokenId) public view returns (address) {
        require(exists(tokenId), "ImageNFT: author query for nonexistent token");
        return _authors[tokenId];
    }

    function burn(address _from, uint256 _tokenId, uint256 _amount) external {
        require(
            _from == msg.sender || isApprovedForAll(_from, msg.sender),
            "ImageNFT: caller is not owner nor approved"
        );
        
        _burn(_from, _tokenId, _amount);

        if(totalSupply(_tokenId) == 0) {
            delete uris[_tokenId];
            delete _authors[_tokenId];
            _resetTokenRoyalty(_tokenId);
        }
    }
}