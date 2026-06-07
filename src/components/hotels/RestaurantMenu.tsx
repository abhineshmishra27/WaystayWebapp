interface MenuItemType {
  id: string
  category: string
  name: string
  description?: string | null
  price: number
  isVeg: boolean
}

interface RestaurantType {
  name: string
  menuItems: MenuItemType[]
}

export default function RestaurantMenu({ restaurant }: { restaurant: RestaurantType }) {
  const categories = [...new Set(restaurant.menuItems.map((item: MenuItemType) => item.category))] as string[]

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">🍽 Restaurant: {restaurant.name}</h2>
      {categories.map(category => (
        <div key={category} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{category}</h3>
          <div className="space-y-2">
            {restaurant.menuItems.filter((item: MenuItemType) => item.category === category).map((item: MenuItemType) => (
              <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div className="flex items-center gap-3">
                  <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${item.isVeg ? 'border-green-500' : 'border-red-500'}`}>
                    <span className={`w-2 h-2 rounded-full ${item.isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.name}</p>
                    {item.description && <p className="text-xs text-gray-400">{item.description}</p>}
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-800">₹{item.price}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
