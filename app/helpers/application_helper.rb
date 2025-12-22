module ApplicationHelper
  def nav_link_classes(active:)
    base = "group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold transition-colors"
    if active
      "#{base} bg-gray-100 dark:bg-zinc-800 text-violet-600 dark:text-violet-400"
    else
      "#{base} text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-violet-600 dark:hover:text-violet-400"
    end
  end

  def nav_icon_classes(active:)
    base = "size-6 shrink-0 transition-colors"
    if active
      "#{base} text-violet-600 dark:text-violet-400"
    else
      "#{base} text-gray-400 dark:text-zinc-500 group-hover:text-violet-600 dark:group-hover:text-violet-400"
    end
  end

  def current_controller?(*names)
    names.include?(controller_name)
  end
end
