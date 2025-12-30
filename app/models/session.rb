class Session < ApplicationRecord
  belongs_to :user

  def current?(current_session)
    id == current_session&.id
  end

  def device_name
    return 'Unknown device' if user_agent.blank?

    case user_agent
    when /iPhone/i then 'iPhone'
    when /iPad/i then 'iPad'
    when /Android/i then 'Android'
    when /Macintosh|Mac OS/i then 'Mac'
    when /Windows/i then 'Windows'
    when /Linux/i then 'Linux'
    else 'Unknown device'
    end
  end

  def browser_name
    return 'Unknown browser' if user_agent.blank?

    case user_agent
    when /Chrome/i then 'Chrome'
    when /Safari/i then 'Safari'
    when /Firefox/i then 'Firefox'
    when /Edge/i then 'Edge'
    when /Opera|OPR/i then 'Opera'
    else 'Unknown browser'
    end
  end

  def device_description
    "#{device_name} • #{browser_name}"
  end
end
