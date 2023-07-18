import {
  TransactionHandlerType,
  TransactionPayload,
  TransactionStepHandler,
  TransactionStepsDefinition,
} from "../../../utils/transaction"
import {
  IInventoryService,
  MedusaContainer,
  ProductTypes,
} from "@medusajs/types"
import {
  defaultAdminProductFields,
  defaultAdminProductRelations,
} from "../../../api"
import {
  attachInventoryItems,
  attachSalesChannelToProducts,
  attachShippingProfileToProducts,
  createInventoryItems,
  createProducts,
  CreateProductsData,
  CreateProductsPreparedData,
  detachInventoryItems,
  detachSalesChannelFromProducts,
  detachShippingProfileFromProducts,
  prepareCreateProductsData,
  removeInventoryItems,
  removeProducts,
  updateProductsVariantsPrices,
} from "../../functions"
import { PricingService, ProductService } from "../../../services"
import { CreateProductsWorkflowInputData, InjectedDependencies } from "./types"

export enum CreateProductsWorkflowActions {
  prepare = "prepare",
  createProducts = "createProducts",
  attachToSalesChannel = "attachToSalesChannel",
  attachShippingProfile = "attachShippingProfile",
  createPrices = "createPrices",
  createInventoryItems = "createInventoryItems",
  attachInventoryItems = "attachInventoryItems",
  result = "result",
}

export const workflowSteps: TransactionStepsDefinition = {
  next: {
    action: CreateProductsWorkflowActions.prepare,
    saveResponse: true,
    noCompensation: true,
    next: {
      action: CreateProductsWorkflowActions.createProducts,
      saveResponse: true,
      next: [
        {
          action: CreateProductsWorkflowActions.attachShippingProfile,
        },
        {
          action: CreateProductsWorkflowActions.attachToSalesChannel,
        },
        {
          action: CreateProductsWorkflowActions.createPrices,
          next: {
            action: CreateProductsWorkflowActions.createInventoryItems,
            saveResponse: true,
            next: {
              action: CreateProductsWorkflowActions.attachInventoryItems,
              saveResponse: true,
              next: {
                action: CreateProductsWorkflowActions.result,
                noCompensation: true,
                saveResponse: true,
              },
            },
          },
        },
      ],
    },
  },
}

const shouldSkipInventoryStep = (
  container: MedusaContainer,
  stepName: string
) => {
  const inventoryService = container.resolve(
    "inventoryService"
  ) as IInventoryService
  if (!inventoryService) {
    const logger = container.resolve("logger")
    logger.warn(
      `Inventory service not found. You should install the @medusajs/inventory package to use inventory. The '${stepName}' will be skipped.`
    )
    return true
  }

  return false
}

export function transactionHandler(
  dependencies: InjectedDependencies
): TransactionStepHandler {
  const { manager, container } = dependencies

  const command = {
    [CreateProductsWorkflowActions.prepare]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData
      ) => {
        return await prepareCreateProductsData({
          container,
          manager,
          data,
        })
      },
    },

    [CreateProductsWorkflowActions.createProducts]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsData
      ): Promise<ProductTypes.ProductDTO[]> => {
        return await createProducts({
          container,
          data,
        })
      },
      [TransactionHandlerType.COMPENSATE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]

        return await removeProducts({
          container,
          data: products,
        })
      },
    },

    [CreateProductsWorkflowActions.attachShippingProfile]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]
        const { productsHandleShippingProfileIdMap } = invoke[
          CreateProductsWorkflowActions.prepare
        ] as CreateProductsPreparedData

        return await attachShippingProfileToProducts({
          container,
          manager,
          data: {
            productsHandleShippingProfileIdMap,
            products,
          },
        })
      },
      [TransactionHandlerType.COMPENSATE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]
        const { productsHandleShippingProfileIdMap } = invoke[
          CreateProductsWorkflowActions.prepare
        ] as CreateProductsPreparedData

        return await detachShippingProfileFromProducts({
          container,
          manager,
          data: {
            productsHandleShippingProfileIdMap,
            products,
          },
        })
      },
    },

    [CreateProductsWorkflowActions.attachToSalesChannel]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]
        const { productsHandleSalesChannelsMap } = invoke[
          CreateProductsWorkflowActions.prepare
        ] as CreateProductsPreparedData

        return await attachSalesChannelToProducts({
          container,
          manager,
          data: {
            productsHandleSalesChannelsMap,
            products,
          },
        })
      },
      [TransactionHandlerType.COMPENSATE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]
        const { productsHandleSalesChannelsMap } = invoke[
          CreateProductsWorkflowActions.prepare
        ] as CreateProductsPreparedData

        return await detachSalesChannelFromProducts({
          container,
          manager,
          data: {
            productsHandleSalesChannelsMap,
            products,
          },
        })
      },
    },

    [CreateProductsWorkflowActions.createInventoryItems]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const shouldSkipStep_ = shouldSkipInventoryStep(
          container,
          CreateProductsWorkflowActions.createInventoryItems
        )
        if (shouldSkipStep_) {
          return
        }

        const { [CreateProductsWorkflowActions.createProducts]: products } =
          invoke

        return await createInventoryItems({
          container,
          manager,
          data: products,
        })
      },
      [TransactionHandlerType.COMPENSATE]: async (_, { invoke }) => {
        const shouldSkipStep_ = shouldSkipInventoryStep(
          container,
          CreateProductsWorkflowActions.createInventoryItems
        )
        if (shouldSkipStep_) {
          return
        }

        const variantInventoryItemsData =
          invoke[CreateProductsWorkflowActions.createInventoryItems]

        await removeInventoryItems({
          container,
          manager,
          data: variantInventoryItemsData,
        })
      },
    },

    [CreateProductsWorkflowActions.attachInventoryItems]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const shouldSkipStep_ = shouldSkipInventoryStep(
          container,
          CreateProductsWorkflowActions.attachInventoryItems
        )
        if (shouldSkipStep_) {
          return
        }

        const {
          [CreateProductsWorkflowActions.createInventoryItems]:
            inventoryItemsResult,
        } = invoke

        return await attachInventoryItems({
          container,
          manager,
          data: inventoryItemsResult,
        })
      },
      [TransactionHandlerType.COMPENSATE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const shouldSkipStep_ = shouldSkipInventoryStep(
          container,
          CreateProductsWorkflowActions.attachInventoryItems
        )
        if (shouldSkipStep_) {
          return
        }

        const {
          [CreateProductsWorkflowActions.createInventoryItems]:
            inventoryItemsResult,
        } = invoke

        return await detachInventoryItems({
          container,
          manager,
          data: inventoryItemsResult,
        })
      },
    },

    [CreateProductsWorkflowActions.createPrices]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const { productsHandleVariantsIndexPricesMap } = invoke[
          CreateProductsWorkflowActions.prepare
        ] as CreateProductsPreparedData
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]

        return await updateProductsVariantsPrices({
          container,
          manager,
          data: {
            products,
            productsHandleVariantsIndexPricesMap,
          },
        })
      },
      [TransactionHandlerType.COMPENSATE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const { productsHandleVariantsIndexPricesMap } = invoke[
          CreateProductsWorkflowActions.prepare
        ] as CreateProductsPreparedData
        const products = invoke[
          CreateProductsWorkflowActions.createProducts
        ] as ProductTypes.ProductDTO[]

        const updatedProductsHandleVariantsIndexPricesMap = new Map()
        productsHandleVariantsIndexPricesMap.forEach(
          ({ index, prices }, productHandle) => {
            updatedProductsHandleVariantsIndexPricesMap.set(productHandle, {
              index,
              prices: [],
            })
          }
        )

        return await updateProductsVariantsPrices({
          container,
          manager,
          data: {
            products,
            productsHandleVariantsIndexPricesMap:
              updatedProductsHandleVariantsIndexPricesMap,
          },
        })
      },
    },

    [CreateProductsWorkflowActions.result]: {
      [TransactionHandlerType.INVOKE]: async (
        data: CreateProductsWorkflowInputData,
        { invoke }
      ) => {
        const { [CreateProductsWorkflowActions.createProducts]: products } =
          invoke

        const productService = container.resolve(
          "productService"
        ) as ProductService
        const pricingService = container.resolve(
          "pricingService"
        ) as PricingService

        const rawProduct = await productService
          .withTransaction(manager)
          .retrieve(products[0].id, {
            select: defaultAdminProductFields,
            relations: defaultAdminProductRelations,
          })

        const res = await pricingService
          .withTransaction(manager)
          .setProductPrices([rawProduct])

        return res
      },
    },
  }

  return (
    actionId: string,
    type: TransactionHandlerType,
    payload: TransactionPayload
  ) => command[actionId][type](payload.data, payload.context)
}
