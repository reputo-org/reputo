export interface ChainDisplayMeta {
  label: string
  iconUrl: string
}

export interface TargetDisplayMeta {
  chainId: string
  targetIdentifier: string
  label: string
  iconUrl: string
  explorerUrl?: string
  explorerName?: string
}

const CHAIN_META: Record<string, ChainDisplayMeta> = {
  ethereum: {
    label: "Ethereum",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  },
  cardano: {
    label: "Cardano",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/cardano/info/logo.png",
  },
  cosmos: {
    label: "Cosmos",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/cosmos/info/logo.png",
  },
}

const TARGET_META: Record<string, TargetDisplayMeta> = {
  "ethereum:0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85": {
    chainId: "ethereum",
    targetIdentifier: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
    label: "FET",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85/logo.png",
    explorerUrl:
      "https://etherscan.io/token/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
    explorerName: "Etherscan",
  },
  "ethereum:0xCB85b101C4822A4E3ABCa20e57f1DFf0E2673475": {
    chainId: "ethereum",
    targetIdentifier: "0xCB85b101C4822A4E3ABCa20e57f1DFf0E2673475",
    label: "FET Staking",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85/logo.png",
    explorerUrl:
      "https://etherscan.io/address/0xCB85b101C4822A4E3ABCa20e57f1DFf0E2673475",
    explorerName: "Etherscan",
  },
  "ethereum:0x351baC612B50e87B46e4b10A282f632D41397DE2": {
    chainId: "ethereum",
    targetIdentifier: "0x351baC612B50e87B46e4b10A282f632D41397DE2",
    label: "FET Staking",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85/logo.png",
    explorerUrl:
      "https://etherscan.io/address/0x351baC612B50e87B46e4b10A282f632D41397DE2",
    explorerName: "Etherscan",
  },
  "cardano:e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9": {
    chainId: "cardano",
    targetIdentifier:
      "e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9",
    label: "FET",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85/logo.png",
    explorerUrl:
      "https://cardanoscan.io/token/e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9464554?address=addr1qyq5d39ksne5v0sk3fphv8yhts6kydarzx6r3t3vvmmcdkt5r52wtka55ssha0mdrs8je9r60pp0ve9ys8he6jv88jvsmuztnz",
    explorerName: "Cardanoscan",
  },
  "cosmos:afet": {
    chainId: "cosmos",
    targetIdentifier: "afet",
    label: "FET",
    iconUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85/logo.png",
    explorerUrl: "https://www.mintscan.io/fetchai",
    explorerName: "Mintscan",
  },
}

export function getChainMeta(chainId: string): ChainDisplayMeta | undefined {
  return CHAIN_META[chainId]
}

export function getTargetMeta(
  chainId: string,
  targetIdentifier: string
): TargetDisplayMeta | undefined {
  return TARGET_META[`${chainId}:${targetIdentifier}`]
}
